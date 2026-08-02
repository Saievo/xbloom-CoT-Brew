# xbloom-CoT-Brew

基于 [xbloom-agent](https://github.com/denull0/xbloom-agent) 魔改，感谢原作者 [@denull0](https://github.com/denull0) 的开源工作。

原项目提供了 Claude + MCP 驱动 XBloom Studio 的基础架构，本项目在此基础上引入了**数据驱动的 CoT（Chain-of-Thought）推演机制**：在输出任何冲煮参数之前，强制 Claude 先完成对豆子烘焙度、处理法、溶解率、水温适用性、振动策略的逐项推演，而不是直接套模板。

---

## 项目介绍

xbloom-CoT-Brew 是一个运行在 Claude Code CLI 上的咖啡配方助手，通过本地 MCP Server 与 XBloom 云端 API 通信，将配方直接推送到你的 XBloom Studio App。

**核心改进：**

- **CoT 强制推演**：每次出配方前，Claude 必须先分析豆子特性（烘焙度/处理法/海拔/密度），评估萃取难度，逐项检验水温、振动、Pattern 是否适用，推演完成后才允许输出参数。杜绝"捷径依赖"——对所有豆子套用同一套模板。
- **数据驱动知识库**：基于 453 条 XBloom 官方配方提炼的统计规律，包含 7 个豆子类型基准模板、处理法 → Bloom 参数映射、振动策略分析、Pattern 序列统计。
- **配方推荐标记**：根据豆子特性自动判断热饮/冰饮适合程度，在配方名称前标注 ⭐️（推荐）或 ⚠️（不推荐）。

---

## 运行环境：Hermes

本项目已适配 [Hermes Agent](https://github.com/NousResearch/hermes-agent)（也兼容 Claude Code，AGENTS.md / CLAUDE.md 保持同步）。

**迁移内容**：

- Hermes project `xbloom` 挂载本仓库（主目录），自动读取 `AGENTS.md`
- MCP server 已注册：`hermes mcp add xbloom --command node --args <仓库绝对路径>/mcp-server/dist/index.js`（16 个工具）
- 技能通过 `~/.hermes/config.yaml` 的 `skills.external_dirs` 指向 `.agents/skills`（只读外链，仓库为唯一数据源）

**新机器搭建**：

```bash
cd mcp-server && npm install && npm run build
hermes mcp add xbloom --command node --args "$PWD/mcp-server/dist/index.js"
```

并在 `~/.hermes/config.yaml` 的 `skills` 段添加：

```yaml
skills:
  external_dirs:
    - /绝对路径/xbloom-agent/.agents/skills
```

本地数据（`~/.xbloom/`：config / beans / preferences / history / water）由 MCP 工具读写，跨平台共享。

**反馈闭环**：每次推送配方后自动写入 `history.json` 并回写豆库统计（brewCount / lastBrewedAt / lastRating）；冲完用 `taste` 技能记录评分与反馈，后续配方优先复用同豆子的高分参数组合。

---

## 登录

首次使用前需要登录 XBloom 账号，token 保存在本地 `~/.xbloom/config.json`（项目目录之外，不会进入 git）：

```
帮我登录 XBloom，邮箱 xxx，密码 xxx
```

登录后 token 长期有效，无需重复登录。Session 过期时 Claude 会提示重新登录。

---

## 知识库

| 文件 | 用途 |
|------|------|
| `data/xbloom_brewing_knowledge_base.md` | **主知识库**。基于 453 条官方配方提炼的数据规律，包含 7 个豆子类型基准模板（Template A–G）、处理法 → Bloom 参数映射、振动策略分析、Pattern 序列统计。推演新配方时必读。 |
| `data/brewing-reference.md` | 通用手冲科学参考（Kasuya、Hoffmann、Rao 等方法论）。作为主知识库的补充，用于理解萃取原理。 |
| `data/recipes_v2.json` | **原始配方数据集**。449 条 XBloom 官方配方的完整原始数据，知识库的数据来源。供二次分析或研究使用。 |
| `data/recipes_readable.md` | **可读版配方数据集**。将原始 JSON 转换为人类可读的 Markdown，参数中文化（螺旋/环形/中心注水、段前/段后震动等），按产地分组并附目录索引，方便直接阅读参考。 |

---

## 加新豆子

通过 `/beans` 命令添加豆子信息：

```
/beans 添加一款新豆：肯尼亚 Nyeri，水洗，浅烘，烘焙日期 2026-05-01
```

豆子信息保存在 `~/.xbloom/beans.json`，后续 `/brew` 时可直接从豆库选取。

---

## 输出冲煮方案

使用 `/brew` 命令，支持文字描述或直接拍照：

**文字输入：**
```
/brew 帮我给这款豆子出一个热饮配方
```

**拍照输入：**
直接拍一张咖啡袋的照片发给 Claude，然后说：
```
/brew 帮我给这款豆子出冲煮方案
```
Claude 会自动识别袋子上的产地、处理法、烘焙度等信息，直接推演配方。

**甚至不需要输入命令：**
直接告诉 Claude 你的需求就行，比如"帮我给这款豆子出个方案"、"我想喝这个豆子"，Claude 会自动触发推演流程。

**`/brew` 的执行流程：**

1. 读取豆库、偏好、水质、历史记录
2. 读取 `data/xbloom_brewing_knowledge_base.md`，定位对应基准模板
3. 执行 CoT 推演：
   - 烘焙度与处理法 → 定位基准模板
   - 溶解率与排气状态评估
   - 逐项检验水温、振动、Pattern 是否适用于当前豆子
4. 输出配方卡片（含推荐标记），等待确认
5. 确认后推送到 XBloom 云端，手机 App 下拉刷新即可使用

**CoT 推演是强制步骤，不允许跳过直接套模板。**

---

## License

MIT
