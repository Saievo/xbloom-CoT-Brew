---
name: taste
description: "Record brewing feedback, compare same-bean history, update preferences, and iterate on recipes."
---

# Taste & Feedback

Record how a brew tasted and use the feedback to improve future recipes.

## Load Context

1. Call `xbloom_get_history`（limit 30）读取最近冲煮记录——每条含 id、豆子、完整参数、评分、反馈
2. Call `xbloom_get_preferences` 读取当前口味偏好
3. 偏好不存在时，用中性默认值（sourBitterBias=balanced, strength=medium, bodyPref=medium, aromaPriority=medium）调用 `xbloom_save_preferences` 初始化，再继续

## Workflow

1. 询问用户评价哪一次冲煮（默认最近一次）
2. 收集反馈（新维度，用户品不出/没喝出来就跳过，不强迫）：
   - 总体评分 1-5 星
   - 酸/涩/苦：各选 弱 / 中 / 强（感知强度，不是好坏；好不好看总体星）
   - body 口感：清爽 / 适中 / 厚重
   - 香气：没闻到 / 淡 / 明显（可选附类型：花香/果香/坚果/焦糖/发酵酒香…）——没闻到也是有效数据
   - 卡粉：有/无（Web 端按 brewTime vs 预期时长自动预判，可修改）
   - 可选一句话备注；并询问是否"需要迭代参数建议"（wantIteration）
3. **更新原记录**：用 `xbloom_save_history` 传入该记录已有的 `id` + `taste` 对象就地更新（不要新增重复条目）。豆库统计由该工具自动回写。
4. **同豆对比（关键步骤）**：从历史中筛出同一只豆子（beanId/beanName 匹配）的最近 2-3 条记录，逐项对比：
   - 参数差异：研磨度、水温、比例、段数、pattern 各自怎么变的
   - 结果变化：评分和反馈如何随参数变化
   - 结论：锁定表现最好的参数组合，下次给这只豆子出配方时优先复用它，而不是重新推演
5. 根据积累的反馈更新偏好（`xbloom_save_preferences`：sourBitterBias/strength/bodyPref/aromaPriority）
6. 结合冲煮参考给出具体调整建议：
   - Too bitter → coarser grind, lower temp, less agitation
   - Too sour → finer grind, higher temp, more agitation
   - Too weak → higher ratio, finer grind, more pours
   - Too strong → lower ratio, coarser grind, fewer pours
   - **卡粉杯次不参与上述归因**：先排除磨豆机/机器问题（卡粉可能过萃也可能不过萃），单独提示清理或观察，再谈配方
7. 只有用户勾选/明确要求"需要迭代参数建议"时才产出建议并走确认-应用流程；否则这杯只记录
8. 视情况提议用同一只豆子重新出配方（brew 技能），并复用第 4 步锁定的高分参数

## 记忆同步（可选）

把明确的偏好结论总结成一句话（例如"喜欢明亮果酸，讨厌深烘苦味"），便于 Hermes 写入长期记忆；本地 preferences.json 仍是权威数据源。
