---
name: brew
description: "Design a coffee or tea recipe for XBloom Studio, push to cloud, and save to local history."
---

# Brew a Recipe

Design a pour-over or tea recipe for the user's XBloom Studio machine.

## Context

Read the user's preferences and history first:

!`cat ~/.xbloom/preferences.json 2>/dev/null || echo "No preferences saved yet."`

!`cat ~/.xbloom/beans.json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const b=JSON.parse(d);console.log(b.map(x=>x.id+': '+x.name+' ('+x.origin+', '+x.roastLevel+')').join('\n'))" 2>/dev/null || echo "No beans saved yet."`

!`cat ~/.xbloom/water.json 2>/dev/null || echo "No water profile saved."`

!`cat ~/.xbloom/history.json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const h=JSON.parse(d).slice(-5);console.log(h.map(x=>x.recipeName+' ('+x.brewedAt.slice(0,10)+') rating:'+x.rating+' — '+x.feedback).join('\n'))" 2>/dev/null || echo "No history yet."`

## Workflow

1. Ask the user about their coffee/tea (or let them pick from their bean library)
2. Consider their taste preferences and past feedback when designing the recipe
3. Read `data/xbloom_brewing_knowledge_base.md` for XBloom-specific baselines (453-recipe dataset, Templates A–G, bloom params by process). Read `data/brewing-reference.md` for general brewing science when needed.
4. **MANDATORY — 知识库推演（先于一切参数输出）：** 根据知识库基准模板，推演出初始参数草稿（研磨度、水温、比例、段数、pattern、震动）。此步骤只做推演，不输出给用户。
5. **MANDATORY — 对比已有配方（推演完成后必做）：** 调用 `xbloom_list_recipes` 获取用户账号中同类型豆子的历史配方（相同/相近的产地、处理法、烘焙度）。**对比维度：**
   - 找出推演参数与已有配方的**差异点**（例：知识库推演水温 93°C，已有配方用 88°C）
   - 判断差异是**合理分歧**（豆子特性不同、设计目标不同）还是**需要修正的冲突**（推演逻辑有误）
   - **禁止纯概率论**：不能因为"多数配方用 X 所以用 X"，每个参数都要有豆子特性的实质理由
   - 对比结论分三类：✅ 推演与已有配方一致，无需修正 / ⚠️ 存在差异，给出具体建议 / 🆕 推演引入新思路，说明理由
6. **MANDATORY — complete this `<thinking>` block before writing any parameters:**
   - **烘焙度与处理法**：明确当前豆子的烘焙度（极浅/浅/中浅/中/中深/深）和处理法（水洗/日晒/蜜处理/厌氧等），定位到知识库对应基准模板。
   - **溶解率与排气状态**：评估豆子的萃取难度。极浅烘/高密度豆（如巴拿马水洗瑰夏）质地坚硬，需要更高温度或更细研磨来提升萃取率；深烘/厌氧豆细胞结构疏松，极易过萃出杂味，需要降温、粗研磨、减少扰动。
   - **⚠️ 瑰夏品种特别注意**：瑰夏不等于"高密度难萃取"！必须查看知识库 5.2.1 节，按产地×处理法区分。**埃塞日晒瑰夏萃取阈值极低（temp 88–91°C, grind 62–68），与巴拿马水洗瑰夏（temp 93–95°C, grind 50–57）参数截然相反。** 当瑰夏+日晒同时出现时，处理法影响 > 品种密度。
   - **逐项检验常用手法是否适用**：
     - 震动（agitate）：只有 Bloom 后才震动（XBloom 官方标准）。主泡段是否需要额外震动？日晒/厌氧豆结构松散，主泡段震动会加速过萃，默认不加；水洗浅烘豆密度高，主泡段也不需要额外震动，靠 spiral pattern 已足够。
     - 水温：是否适合用 93°C 以上？厌氧/中深烘豆不适合高温，应降至 88–91°C；极浅烘水洗高密度豆才适合 93–95°C。
     - 注水段数与 pattern：豆子的风味目标是清晰花香还是厚重甜感？前者用 centered/circular 减少扰动，后者用 spiral 增加萃取。
   - **只有完成上述推演后，才允许输出最终配方参数。**
7. Present a recipe card with all parameters, including a brief **对比摘要**（推演 vs 已有配方的关键差异点和处理结论）
6. **配方命名规则（推荐标记）**：根据豆子特性判断热饮/冰饮的适合程度，在配方名称前加标记：
   - `⭐️ 豆名 · 热饮` / `⭐️ 豆名 · 冰饮`：推荐饮用方式（风味在该温度下表现最佳）
   - `🧊 豆名 · 冰饮`：冰饮专属推荐（如高酸果香型豆子冰饮更清爽）
   - `⚠️ 豆名 · 热饮` / `⚠️ 豆名 · 冰饮`：不推荐（如深烘/厌氧豆冰饮容易出杂味，或浅烘高酸豆热饮酸感过于尖锐）
   - 无标记：热饮冰饮均可，无明显偏好
   - **判断依据**：浅烘花香/果酸型豆子冰饮通常更清透（⭐️冰饮）；日晒/蜜处理甜感型豆子热饮更能展现层次（⭐️热饮）；特殊发酵豆热饮香气更完整，冰饮可能损失发酵香（⚠️冰饮）。
7. After approval, use the appropriate MCP tool:
   - Coffee: `xbloom_create_recipe`
   - Tea: `xbloom_create_tea_recipe`
8. Save to history with `xbloom_save_history`

## Auth Check

!`test -f ~/.xbloom/config.json && echo "Logged in." || echo "NOT LOGGED IN — ask user for XBloom email/password and call xbloom_login first."`

## User Input

$ARGUMENTS
