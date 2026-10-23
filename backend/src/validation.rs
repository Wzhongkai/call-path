use serde_json::Value;
use std::collections::{HashMap, HashSet};

type Check = Result<(), &'static str>;
fn text(value: &Value, max: usize, nonempty: bool) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.chars().count() <= max && (!nonempty || !s.trim().is_empty()))
}
fn id(value: &Value) -> Result<&str, &'static str> {
    value
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 400)
        .ok_or("标识无效")
}
fn array(value: &Value, max: usize) -> Result<&Vec<Value>, &'static str> {
    value
        .as_array()
        .filter(|v| v.len() <= max)
        .ok_or("列表格式错误或超过数量限制")
}
fn color(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 7 && s.starts_with('#') && s.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    })
}
fn position(value: &Value) -> Check {
    for mode in ["logic", "code"] {
        for axis in ["x", "y"] {
            if !value[mode][axis]
                .as_f64()
                .is_some_and(|x| x.is_finite() && x.abs() <= 100_000.)
            {
                return Err("画布坐标无效");
            }
        }
    }
    Ok(())
}
fn document(value: &Value) -> Check {
    if value["schemaVersion"] != 1 || !text(&value["title"], 80, false) {
        return Err("项目格式错误");
    }
    let nodes = array(&value["nodes"], 200)?;
    let edges = array(&value["edges"], 1000)?;
    let mut by_id = HashMap::new();
    for node in nodes {
        let node_id = id(&node["id"])?;
        if by_id.insert(node_id, node).is_some()
            || !text(&node["name"], 100, true)
            || !color(&node["color"])
        {
            return Err("函数标识、名称或颜色无效");
        }
        for field in ["description", "note"] {
            if !text(&node[field], 50_000, false) {
                return Err("函数说明过长或无效");
            }
        }
        if !node["file"].is_null() && !text(&node["file"], 500, false) {
            return Err("所属文件无效");
        }
        if !node["kind"].is_null()
            && !matches!(node["kind"].as_str(), Some("function" | "struct" | "macro"))
        {
            return Err("块类型无效");
        }
        if !node["language"].is_null()
            && !matches!(
                node["language"].as_str(),
                Some(
                    "javascript"
                        | "typescript"
                        | "python"
                        | "rust"
                        | "c"
                        | "cpp"
                        | "java"
                        | "go"
                        | "sql"
                        | "json"
                        | "plain"
                )
            )
        {
            return Err("代码语言无效");
        }
        if !node["indentSize"].is_null() && !matches!(node["indentSize"].as_u64(), Some(2 | 4 | 8))
        {
            return Err("缩进无效");
        }
        if !node["exposeEmbedded"].is_null() && !node["exposeEmbedded"].is_boolean() {
            return Err("嵌入函数设置无效");
        }
        for tag in array(&node["tags"], 20)? {
            if !text(tag, 40, false) {
                return Err("标签无效");
            }
        }
        let code = array(&node["code"], 400)?;
        if code.is_empty() {
            return Err("代码至少需要一行");
        }
        let mut lines = HashSet::new();
        for line in code {
            if !lines.insert(id(&line["id"])?) || !text(&line["text"], 10_000, false) {
                return Err("代码行重复或过长");
            }
        }
        if !node["innerFunctions"].is_null() {
            let mut entries = HashSet::new();
            let mut entry_lines = HashSet::new();
            for entry in array(&node["innerFunctions"], 100)? {
                let line = id(&entry["lineId"])?;
                if !entries.insert(id(&entry["id"])?)
                    || !text(&entry["name"], 100, true)
                    || !lines.contains(line)
                    || !entry_lines.insert(line)
                {
                    return Err("嵌入函数的名称或行号无效");
                }
            }
        }
        position(&node["positions"])?;
    }
    for node in nodes {
        let mut visited = HashSet::new();
        visited.insert(id(&node["id"])?);
        let mut parent = &node["parentId"];
        while !parent.is_null() {
            let parent_id = id(parent)?;
            if !visited.insert(parent_id) {
                return Err("函数归属不能形成循环");
            }
            let owner = by_id.get(parent_id).ok_or("父函数不存在")?;
            parent = &owner["parentId"];
        }
    }
    let mut edge_ids = HashMap::new();
    for edge in edges {
        if edge_ids.insert(id(&edge["id"])?, edge).is_some()
            || !matches!(edge["type"].as_str(), Some("call" | "return"))
        {
            return Err("连线无效");
        }
        for field in ["label", "params", "condition", "note"] {
            if !text(&edge[field], 50_000, false) {
                return Err("连线说明过长或无效");
            }
        }
        for end in ["from", "to"] {
            let node = by_id.get(id(&edge[end])?).ok_or("连线引用了不存在的函数")?;
            let line = &edge[format!("{end}Line")];
            let entry = &edge[format!("{end}Entry")];
            if !line.is_null()
                && !node["code"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|l| l["id"] == *line)
            {
                return Err("连线引用了不存在的代码行");
            }
            if !entry.is_null()
                && !node["innerFunctions"].as_array().is_some_and(|entries| {
                    entries
                        .iter()
                        .any(|e| e["id"] == *entry && e["lineId"] == *line)
                })
            {
                return Err("连线引用了不存在的内部入口");
            }
        }
    }
    for edge in edges {
        if edge["type"] == "return" && !edge["callId"].is_null() && edge["callId"] != "" {
            let call = edge_ids.get(id(&edge["callId"])?).ok_or("关联调用不存在")?;
            if call["type"] != "call" || call["from"] != edge["to"] || call["to"] != edge["from"] {
                return Err("调用与返回不对应");
            }
        }
    }
    let mut group_ids = HashSet::new();
    let mut members = HashSet::new();
    if !value["groups"].is_null() {
        for group in array(&value["groups"], 100)? {
            if !group_ids.insert(id(&group["id"])?)
                || !text(&group["name"], 100, true)
                || !text(&group["note"], 50_000, false)
                || !color(&group["color"])
            {
                return Err("分区无效");
            }
            for member in array(&group["members"], 200)? {
                let member = id(member)?;
                if !by_id.contains_key(member) || !members.insert(member) {
                    return Err("分区成员重复或不存在");
                }
            }
            position(&group["positions"])?;
        }
    }
    Ok(())
}
pub fn workspace(value: &Value) -> Check {
    if value["schemaVersion"] != 1 {
        return Err("工作空间版本不支持");
    }
    let projects = array(&value["projects"], 100)?;
    if projects.is_empty() {
        return Err("至少保留一个项目");
    }
    let trash = array(&value["trash"], 1000)?;
    let mut ids = HashSet::new();
    for project in projects.iter().chain(trash) {
        if !ids.insert(id(&project["id"])?) {
            return Err("项目标识重复");
        }
        if !project["updatedAt"].is_number() {
            return Err("项目时间无效");
        }
        document(&project["document"])?;
        let view = &project["view"];
        if !view.is_null() {
            if !matches!(view["mode"].as_str(), Some("logic" | "code")) {
                return Err("视图模式无效");
            }
            for mode in ["logic", "code"] {
                for axis in ["x", "y"] {
                    if !view["cameras"][mode][axis]
                        .as_f64()
                        .is_some_and(f64::is_finite)
                    {
                        return Err("视图坐标无效");
                    }
                }
                if !view["cameras"][mode]["z"]
                    .as_f64()
                    .is_some_and(|z| (0.2..=2.).contains(&z))
                {
                    return Err("缩放无效");
                }
            }
        }
    }
    if !projects.iter().any(|p| p["id"] == value["activeId"]) {
        return Err("当前项目不存在");
    }
    Ok(())
}
