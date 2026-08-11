# Repository Agent Skills (agent mirror)

本目录存放仓库级协作 skills 的 agent 生态镜像入口（面向 Codex 等非 Claude agent），属于版本库资产。

- 规则真源：仓库根目录 `AGENTS.md`
- 单一真源：`.claude/skills/` 为规则内容真源，本目录是它的分层适配镜像；修改规则内容时以 `.claude/skills/` 为准，再同步本目录
- 差异仅限产物路径：本目录面向 Codex 生态，分析产物保存到 `.Codex/reviews/`；`.claude/skills/` 版本保存到 `.claude/reviews/`
- `.Codex/reviews/` 属于本地分析产物，不作为规则真源

如需新增其他 agent 专用目录，应先明确单一真源，再通过脚本或镜像同步，而不是手工长期维护多份同义内容。
