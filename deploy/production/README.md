# 生产发布工作台

这套发布流程把原来的“本地构建、浏览器上传 Docker 压缩包、手工改 Compose”改为 GitHub Actions 中的手动发布工作流。生产应用本身不会获得 Docker Socket、SSH 私钥或任意命令执行权限。

## 发布效果

- GitHub Actions 自动校验后端、前端和独立的 `relaykit` 模块。
- 自动构建 `linux/amd64` 镜像并以不可变 digest 推送到 GHCR。
- 自动构建前端静态文件，上传前后校验 SHA-256。
- API 先更新并通过容器健康检查，再更新 Worker 和前端。
- 公网健康检查失败时自动恢复上一镜像和前端软链接。
- 每次成功发布都会写入 `/opt/new-api-async-staging/release-history/<release-id>`，可从 GitHub Actions 执行指定版本回滚。
- 同一时间只允许一个生产发布或回滚任务。

## 一次性配置

### 1. 在服务器安装受限发布命令

把本目录复制到服务器后，在 OrcaTerm 中执行一次：

```bash
cd /path/to/repository/deploy/production
sudo ./bootstrap-server.sh ubuntu /opt/new-api-async-staging
```

脚本只允许 `ubuntu` 用户免密执行两个固定的发布命令，不开放任意 `sudo bash`。

如果 GHCR 包是私有的，还需为服务器上的 root Docker 配置一次只读包令牌：

```bash
printf '%s' 'YOUR_GHCR_READ_TOKEN' | sudo docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

令牌只需要 `read:packages` 权限，不要使用仓库管理或写包权限。

### 2. 配置 GitHub Environment

在 GitHub 仓库的 **Settings → Environments** 创建 `production`，建议启用 Required reviewers，然后配置以下 Environment secrets：

| 名称 | 用途 |
| --- | --- |
| `PRODUCTION_HOST` | 生产服务器域名或 IP |
| `PRODUCTION_PORT` | SSH 端口，通常为 `22` |
| `PRODUCTION_USER` | 受限发布用户，当前为 `ubuntu` |
| `PRODUCTION_SSH_KEY` | 仅用于发布的 SSH 私钥 |
| `PRODUCTION_KNOWN_HOSTS` | 经过人工核对的服务器 `known_hosts` 完整行 |

可选 Environment variables：

| 名称 | 默认值 |
| --- | --- |
| `PRODUCTION_DEPLOY_ROOT` | `/opt/new-api-async-staging` |
| `PRODUCTION_FRONTEND_ROOT` | `/var/www/async-api-frontend` |
| `PRODUCTION_HEALTH_URL` | `https://async-api.nexaapp.cn/api/status` |

`PRODUCTION_KNOWN_HOSTS` 不应在工作流中临时通过 `ssh-keyscan` 获取，否则首次连接可能无法识别中间人攻击。

## 日常发布

1. 把准备发布的代码提交并推送到 GitHub。
2. 打开 **Actions → Deploy production**。
3. 点击 **Run workflow**，填写分支、标签或完整 commit SHA。
4. 在确认框输入 `DEPLOY`。
5. 如果 production Environment 配置了审核人，审核后自动发布。

发布成功后，Actions Summary 会显示 release ID、commit、镜像 digest 和线上地址。

## 回滚

1. 打开 **Actions → Roll back production**。
2. 输入 `/opt/new-api-async-staging/release-history/` 下已有的 release ID。
3. 在确认框输入 `ROLLBACK`。

回滚任务会再次执行容器和公网健康检查；如果目标版本也不可用，会恢复回滚前的版本。

## 维护原则

- 不要使用 `latest` 发布生产环境，必须使用工作流生成的镜像 digest。
- 不要把生产 SSH 私钥、GHCR 令牌或 API 密钥写进仓库。
- 不要让 Web 应用挂载 `/var/run/docker.sock`。
- 不要直接删除历史版本；先确认备份、回滚窗口和磁盘占用，再单独制定清理策略。
