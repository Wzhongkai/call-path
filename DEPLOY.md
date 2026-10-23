# Callpath 服务器部署

后端为 Rust + Axum + SQLite。一个服务同时提供网页和 `/api`，无需额外 Node 服务、数据库服务或跨域配置。适合个人、小团队自托管，当前按账号保存完整工作空间快照。

## 推荐：Linux + Docker Compose + HTTPS

准备一台安装 Docker Engine、Compose 插件的 Linux 服务器。把整个项目上传到服务器（不含 `node_modules`、`.git`、`data`、`backend/target`、本地 `.env`）。编辑器已预构建，部署不需要安装前端依赖。

```bash
cp .env.example .env
# 修改 .env：PUBLIC_ORIGIN=https://你的域名
docker compose build
```

默认关闭公开注册。先创建账号；下面的密码从终端隐藏读取，经标准输入传给程序，不放进命令参数、环境变量或 shell 历史：

```bash
read -rsp '新账号密码（至少 8 个字符）: ' callpath_password; echo
printf '%s\n' "$callpath_password" | docker compose run --rm -T app create-user yourname
unset callpath_password
docker compose up -d
docker compose logs --tail=100 app
```

用户名为 3–32 位字母、数字、下划线或短横线，不区分大小写；密码为 8–128 个字符。重复运行 `create-user` 可增加不同使用者。需要开放注册时，把 `.env` 的 `ALLOW_REGISTRATION=true`，再运行 `docker compose up -d`。

`compose.yaml` 只把后端绑定到宿主机 `127.0.0.1:8080`。在宿主机安装 Caddy，把 [deploy/Caddyfile](deploy/Caddyfile) 的域名换成你的域名，配置 DNS，并向公网开放 80/443。Caddy 反向代理到 `127.0.0.1:8080` 并处理 HTTPS。也可以使用已有 Nginx，保持同域转发 `/` 和 `/api/`，请求体上限至少 `21m`，读取超时建议 `60s`。

浏览器必须通过 `PUBLIC_ORIGIN` 的地址访问。生产环境应设为 HTTPS；后端会据此开启 Cookie 的 `Secure` 属性。HTTP 页面无法设置和使用这种 Cookie。若域名或协议改变，更新 `.env` 并重建容器配置。

部署在子路径时，例如 `https://callpath.example.com/code/`：保持 `PUBLIC_ORIGIN=https://callpath.example.com`，另设 `BASE_PATH=/code`。Docker Compose 用户在 `.env` 中设置这两项即可。反向代理用 `location ^~ /code/` 与末尾带斜杠的 `proxy_pass http://127.0.0.1:8080/`，将前缀去掉后交给后端。前端从自身模块位置计算 API 路径，Cookie 仅发送至 `/code/`。`/code` 应重定向到 `/code/`，以保证资源相对路径正确。可参考 [deploy/nginx.conf](deploy/nginx.conf)。

本机 Docker 试用可保留 `.env.example` 的 `http://127.0.0.1:8080`，用该地址访问。临时内网 HTTP 需要同时改端口映射、`PUBLIC_ORIGIN` 并显式设置 `ALLOW_INSECURE_HTTP=true`；正式部署使用 HTTPS。

## 不使用 Docker

使用 Rust 1.99 或更新版本和 C 编译器构建；SQLite 编译到程序内，无需另外安装数据库。

```bash
cargo build --release --locked --manifest-path backend/Cargo.toml
# 在项目根目录运行，默认读取 dist/ 和 data/callpath.sqlite3
ALLOW_REGISTRATION=true cargo run --locked --manifest-path backend/Cargo.toml
# 打开 http://127.0.0.1:8080
```

Windows 可使用 Rust MSVC 工具链，或在 WSL 的项目目录中执行以上命令。PowerShell 设置环境变量的写法为 `$env:ALLOW_REGISTRATION='true'`。

本地编译后上传到不同 Linux 发行版时，可使用 musl 静态编译，避免本机较新的 glibc 与服务器不兼容：

```bash
rustup target add x86_64-unknown-linux-musl
# Ubuntu 本机需要 musl-tools，仅在编译机器安装
CC_x86_64_unknown_linux_musl=musl-gcc cargo build --release --locked \
  --target x86_64-unknown-linux-musl --manifest-path backend/Cargo.toml
```

上传 `backend/target/x86_64-unknown-linux-musl/release/callpath-server`、`dist/` 和运行配置即可，服务器无需 Rust 工具链。每次发布使用独立版本目录并保留上一版，数据库放在版本目录之外。

Linux 长期运行可将二进制与 `dist/` 放到 `/opt/callpath`，创建系统用户 `callpath`，将 [deploy/callpath.service](deploy/callpath.service) 安装到 `/etc/systemd/system/`。在 `/etc/callpath.env` 中填写 `PUBLIC_ORIGIN=https://你的域名` 和 `ALLOW_REGISTRATION=false`。启动 `sudo systemctl enable --now callpath`，前面仍然使用 HTTPS 反向代理。

## 数据与账号维护

- Docker 数据保存在命名卷 `callpath-data`，包含账号、会话及全部项目；升级镜像不会删除数据。不要使用 `docker compose down -v`，它会删除数据卷。
- 每个账号只能访问自己的工作空间；用户名不是数据目录。数据保存在 SQLite，不写入网页目录，不会由静态文件服务公开。
- 登录有效期为 7 天；退出使当前会话失效；修改或重置密码使该账号所有会话失效。密码用 Argon2id 哈希，数据库只保留会话令牌的 SHA-256 哈希。
- 默认关闭公开注册，也不提供默认账号、默认密码。当前没有邮箱找回、邀请、管理员网页、项目共享或多人实时协作。
- 管理员忘记密码时，可使用同样的标准输入方式重置：

```bash
read -rsp '新密码: ' callpath_password; echo
printf '%s\n' "$callpath_password" | docker compose run --rm -T app reset-password yourname
unset callpath_password
```

## 迁移原来的项目

登录后默认打开该账号的服务端项目，不自动上传或覆盖浏览器旧数据。

1. 点击右上角用户名 →「导入此浏览器原有项目」，将当前域名下旧的本地项目复制到账号中；服务器已有项目会保留。
2. 换了服务器域名时，浏览器的本地存储不同。先在旧地址导出各项目 JSON，再到新地址从左下角导入；导入会替换当前打开项目，建议先新建空项目。
3. 账号弹窗的「下载完整工作空间」包含活动项目、最近删除及视图；「从备份添加项目」会添加备份中的活动项目，不替换已有项目，回收站项目需先在原工作空间恢复后再导入。

账号模式不会写入原有本地项目存储。未同步草稿按账号 ID 和标签页分别暂存在当前浏览器，成功保存后清理对应草稿；当前标签页刷新后可恢复。其他标签页同步成功不会清理本页草稿。本机存储空间不足时请直接下载备份。共享电脑使用后应点击「保存并退出登录」。

## 同步和容量

编辑约 0.9 秒后自动保存，界面显示「已保存到服务器」。断网会保留草稿并自动重试；刷新后可恢复相同服务器版本的草稿。关闭页面前若还有未同步数据，浏览器会提示。

两个设备或标签页同时修改同一个账号时，以服务端 revision 检测冲突：第一个保存成功，后续旧版本收到 409，停止自动写入。请先下载完整副本，再加载服务器版本；需要保留的项目可以从副本添加。暂不自动合并不同项目的并行修改。其他标签页切换账号时，旧页会暂停同步，防止把旧账号的数据写入新账号。

当前仍沿用原型容量：每个项目最多 200 个块、1000 条线，每块最多 400 行，最多 100 个活动项目和 1000 个最近删除项目；每个账号工作空间最多 20 MiB。此版本没有宣称支持上万个函数的全量画布渲染。未来大项目应改为分项目 API、分段加载及增量保存。

登录/注册限流为单用户名 15 次 / 15 分钟、单后端连接 IP 100 次 / 15 分钟，计数随进程重启清零。使用反向代理时不会信任客户端随意伪造的 `X-Forwarded-For`，因此所有代理请求共享连接 IP 限额；使用者较多时应在可信代理层增加来源限流并调整后端策略。

## 备份、恢复与更新

账号弹窗的 JSON 备份只包含当前账号的项目；完整服务器备份需要保存 SQLite 数据文件。SQLite 使用 WAL 模式，不要在运行期间单独复制主数据库文件。

最简单的一致性备份方式是短暂停止服务，再复制整个数据目录：

```bash
docker compose stop app
docker compose cp app:/app/data ./callpath-backup
docker compose start app
```

恢复时先停止服务，把备份中的 `callpath.sqlite3` 及同批次存在的 `-wal`、`-shm` 文件恢复到数据卷，确保 UID/GID 10001 可读写。恢复到空目录，不要把不同时间的 WAL 与主库混用。备份含私有代码和账号信息，应妥善保管。

升级前备份，然后执行 `docker compose up -d --build`。当前是初版数据库 schema v1，后续改变表结构时需新增迁移，不能直接把 `CREATE TABLE IF NOT EXISTS` 当成升级迁移。

## 接口和验证

| 接口 | 用途 |
| --- | --- |
| `GET /api/config` | 后端能力、是否允许注册 |
| `GET /api/health` | 服务及数据库健康检查 |
| `POST /api/auth/register` | 创建账号并登录，默认关闭 |
| `POST /api/auth/login` | 用户名和密码登录 |
| `GET /api/auth/me` | 当前账号 |
| `POST /api/auth/logout` | 当前会话退出 |
| `POST /api/auth/password` | 校验旧密码并更改密码 |
| `GET /api/workspace` | 当前账号的工作空间和 revision |
| `PUT /api/workspace` | `{revision, workspace}`，冲突返回 409 |

写接口需要 `X-Callpath-Request: 1`；浏览器的 `Origin` 必须与 `PUBLIC_ORIGIN` 一致。前端附带 `X-Callpath-User` 绑定当前页账号，后端验证其与会话一致。Cookie 为 HttpOnly、SameSite=Lax、有效期 7 天，HTTPS 下为 Secure。接口不开放跨域访问。TLS 必须由反向代理提供。

```bash
node --test tests/*.test.mjs
cargo test --locked --manifest-path backend/Cargo.toml
cargo clippy --locked --manifest-path backend/Cargo.toml --all-targets -- -D warnings
```

前端测试覆盖草稿恢复、断线重试、连续编辑的串行保存和冲突处理；后端集成测试覆盖账号隔离、数据库重开、并发版本冲突、跨站请求拒绝、会话失效、密码修改及限流。
