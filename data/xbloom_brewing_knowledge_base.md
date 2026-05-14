---
name: xbloom-brewing-knowledge-base
description: "从453条官方xBloom配方数据集中提炼的冲煮规律、基准模板和参数调整逻辑。用于推演新豆初始配方。"
---

# xBloom 冲煮知识库 v1.0

> 数据来源：453条官方/高赞配方（official=1 占444条，likesCount>3000 占132条）
> 分析日期：2026-05-04

---

## 一、核心参数映射规律

### 1.1 烘焙度编码

| roast值 | 含义 | 样本量 |
|---------|------|--------|
| 1 | 浅烘 (Light) | 226 |
| 2 | 中浅烘 (Medium-Light) | 84 |
| 3 | 中深烘 (Medium-Dark) | 69 |
| 4 | 深烘 (Dark) | 8 |
| 5 | 极深烘 (Very Dark) | 10 |

### 1.2 烘焙度 → 研磨度 (grinderSize)

**规律：研磨度与烘焙度并非简单线性关系，浅烘反而偏细。**

| roast | 均值 | 中位数 | 范围 |
|-------|------|--------|------|
| 1 (浅) | 55.9 | 57 | 35–80 |
| 2 (中浅) | 59.5 | 59.5 | 41–70 |
| 3 (中深) | 56.9 | 55 | 45–70 |
| 4 (深) | 59.1 | 58 | 50–70 |
| 5 (极深) | 59.6 | 60.5 | 40–70 |

> **关键洞察**：浅烘豆研磨度中位数57，中浅烘反而更粗（59.5）。这是因为浅烘豆密度高、需要更细研磨来充分萃取；中浅烘豆已开始软化，适当放粗以控制苦味。

### 1.3 烘焙度 → 水温

| roast | 全程均温 | Bloom均温 |
|-------|---------|----------|
| 1 (浅) | 92.1°C | 92.9°C |
| 2 (中浅) | 91.6°C | 92.4°C |
| 3 (中深) | 91.5°C | 92.6°C |
| 4 (深) | 90.2°C | 91.0°C |
| 5 (极深) | 90.0°C | 91.8°C |

> **规律**：温度随烘焙度加深而降低，但降幅不大（浅→深约降2°C）。Bloom温度普遍比后续注水高0.5–1°C。

### 1.4 烘焙度 → 粉水比 (ratio)

| roast | 均值 | 中位数 |
|-------|------|--------|
| 1 (浅) | 16.2 | 16 |
| 2 (中浅) | 16.0 | 16 |
| 3 (中深) | 15.7 | 16 |
| 4 (深) | 15.4 | 15 |
| 5 (极深) | 15.5 | 16 |

> **规律**：浅烘偏高比例（1:16–17），深烘偏低（1:15），整体集中在1:15–17。

### 1.5 研磨转速 (rpm) 分布

| rpm | 配方数 | 占比 |
|-----|--------|------|
| 120 | 263 | 66% |
| 60 | 50 | 13% |
| 80 | 26 | 7% |
| 110 | 23 | 6% |
| 100 | 19 | 5% |

> **规律**：120rpm 是绝对主流（66%）。60rpm 用于需要低速研磨的特殊豆（如肯尼亚AA、巴拿马精品豆），可能与减少细粉、保留风味有关。

---

## 二、处理法 → 闷蒸参数规律

### 2.1 处理法分类闷蒸基准

| 处理法类别 | Bloom比 (×dose) | Bloom暂停 | Bloom温度 | 样本量 |
|-----------|----------------|----------|----------|--------|
| Washed (水洗) | 3.3x | 25.0s | 93.1°C | 122 |
| Natural (日晒) | 3.5x | 23.5s | 93.1°C | 87 |
| Honey (蜜处理) | 3.7x | 26.2s | 92.7°C | 23 |
| Special_Fermented (特殊发酵) | 3.4x | 26.3s | 92.5°C | 79 |
| Decaf (脱因) | 2.8x | 22.0s | 92.2°C | 4 |

### 2.2 关键差异解读

**水洗 vs 日晒**：
- 日晒豆 Bloom 比例更高（3.5x vs 3.3x），因为日晒豆含有更多可溶性糖分和果胶，需要更多水来充分润湿
- 水洗豆 Bloom 暂停更长（25s vs 23.5s），给予更充分的排气时间（水洗豆CO₂含量通常更高）

**特殊发酵处理法**：
- Bloom 暂停最长（26.3s），与水洗相当
- 温度略低（92.5°C），避免过度萃取发酵产生的挥发性香气
- 典型案例：厌氧豆（Anaerobic）、共发酵（Co-ferment）、酵母处理（Yeast Washed）

**蜜处理**：
- Bloom 比例最高（3.7x），因为蜜处理保留了果胶层，吸水性强
- 暂停时间居中（26.2s）

**脱因豆**：
- Bloom 比例最低（2.8x），脱因处理使豆子细胞结构更疏松，不需要太多水来润湿
- 暂停时间最短（22s）

---

## 三、注水段数与 Pattern 规律

### 3.1 段数分布

| 段数 | 配方数 | 占比 |
|------|--------|------|
| 3段 | 60 | 15% |
| 4段 | 179 | 45% |
| 5段 | 128 | 32% |
| 6段 | 10 | 3% |
| 7段 | 19 | 5% |

> **4段和5段合计占77%，是绝对主流。**

### 3.2 Pattern 含义

| pattern值 | 名称 | 特点 |
|-----------|------|------|
| 1 | centered (中心) | 集中注水，萃取率低，适合收尾降温 |
| 2 | circular (环形) | 均匀萃取，最常用 |
| 3 | spiral (螺旋) | 高萃取率，适合浅烘/需要充分萃取 |

### 3.3 高频 Pattern 序列

**4段配方 Top 5：**
| 序列 | 出现次数 | 适用场景 |
|------|---------|---------|
| (2,2,2,2) | 34 | 均匀萃取，中规中矩 |
| (2,2,2,1) | 31 | 收尾降温，减少苦味 |
| (3,3,1,2) | 17 | 高萃取开局，中心收尾 |
| (3,3,3,3) | 12 | 全程高萃取，浅烘专用 |
| (2,2,2,3) | 11 | 后段加强萃取 |

**5段配方 Top 5：**
| 序列 | 出现次数 | 适用场景 |
|------|---------|---------|
| (2,2,2,2,2) | 34 | 标准均匀萃取 |
| (2,2,2,3,3) | 14 | 后段螺旋加强 |
| (3,3,2,3,3) | 12 | 高萃取夹心 |
| (2,2,3,2,3) | 9 | 交替萃取 |
| (2,1,3,3,2) | 8 | 特殊节奏 |

### 3.4 各步骤参数基准

**4段配方各步骤均值：**
| 步骤 | 温度 | 暂停 | 主流Pattern | 注水比(×dose) |
|------|------|------|------------|--------------|
| Bloom | 92.3°C | 19.6s | circular(2) | 3.34x |
| Pour1 | 92.3°C | 14.0s | circular(2) | 4.53x |
| Pour2 | 91.1°C | 12.4s | circular(2) | 4.26x |
| Pour3 | 89.3°C | 5.2s | circular(2) | 3.50x |

**5段配方各步骤均值：**
| 步骤 | 温度 | 暂停 | 主流Pattern | 注水比(×dose) |
|------|------|------|------------|--------------|
| Bloom | 93.4°C | 28.4s | circular(2) | 3.41x |
| Pour1 | 93.4°C | 15.2s | circular(2) | 3.55x |
| Pour2 | 93.0°C | 14.6s | circular(2) | 3.33x |
| Pour3 | 92.3°C | 14.0s | spiral(3) | 3.13x |
| Pour4 | 91.3°C | 5.2s | spiral(3) | 2.94x |

> **温度曲线规律**：5段配方温度从Bloom到最后一段通常下降2–4°C，形成降温曲线。4段配方降温更明显（约3°C）。

---

## 四、基准模板 (Baseline Templates)

> 以下模板基于 dose=15g 计算，ratio 决定总水量。实际使用时按比例缩放。

---

### Template A：浅烘水洗非洲豆（Ethiopia/Kenya/Rwanda Washed Light）

**典型豆**：埃塞俄比亚水洗耶加雪菲、肯尼亚AA水洗、卢旺达水洗

**参考配方（高赞案例：Keramo 4450赞、Mutheru Kenya 4395赞）**

```json
{
  "dose_g": 15,
  "grandWater_ratio": 16.5,
  "grinderSize": 57,
  "rpm": 120,
  "pourList": [
    {"step": "Bloom",  "volume_ml": 50,  "temperature_c": 93, "pause_sec": 25, "pattern": 2},
    {"step": "Pour1",  "volume_ml": 65,  "temperature_c": 93, "pause_sec": 15, "pattern": 2},
    {"step": "Pour2",  "volume_ml": 60,  "temperature_c": 92, "pause_sec": 12, "pattern": 3},
    {"step": "Pour3",  "volume_ml": 55,  "temperature_c": 91, "pause_sec": 10, "pattern": 3},
    {"step": "Pour4",  "volume_ml": 47,  "temperature_c": 90, "pause_sec": 0,  "pattern": 2}
  ]
}
```

**参数逻辑**：
- 高比例（1:16.5）突出明亮酸质
- 中等研磨（57）平衡萃取率
- 后段螺旋（pattern 3）充分萃取花香/果酸
- 温度从93°C缓降至90°C，保留层次感

**调整方向**：
- 肯尼亚豆（高酸）→ grind 降至 49–55，ratio 降至 16，Bloom 暂停延长至 30s
- 埃塞俄比亚豆（花香型）→ 保持高温（93–95°C），pattern 多用 spiral

---

### Template B：浅烘日晒非洲豆（Ethiopia Natural Light）

**典型豆**：埃塞俄比亚日晒古吉、西达摩日晒

**参考配方（高赞案例：Oma GV 4940赞、Ethiopia Sidamo 4402赞）**

```json
{
  "dose_g": 15,
  "grandWater_ratio": 16.5,
  "grinderSize": 58,
  "rpm": 120,
  "pourList": [
    {"step": "Bloom",  "volume_ml": 53,  "temperature_c": 95, "pause_sec": 30, "pattern": 2},
    {"step": "Pour1",  "volume_ml": 65,  "temperature_c": 95, "pause_sec": 12, "pattern": 2},
    {"step": "Pour2",  "volume_ml": 60,  "temperature_c": 94, "pause_sec": 10, "pattern": 3},
    {"step": "Pour3",  "volume_ml": 55,  "temperature_c": 93, "pause_sec": 10, "pattern": 3},
    {"step": "Pour4",  "volume_ml": 47,  "temperature_c": 93, "pause_sec": 5,  "pattern": 2}
  ]
}
```

**参数逻辑**：
- 高温（95°C）萃取日晒豆的浆果/热带水果香气
- Bloom 比例 3.5x（53ml/15g），充分润湿果胶层
- 后段保持高温，不降温，保留甜感

---

### Template C：中浅烘特殊发酵豆（Anaerobic / Co-ferment）

**典型豆**：哥伦比亚厌氧、洪都拉斯共发酵、厄瓜多尔厌氧120hr

**参考配方（高赞案例：Hacienda La Papaya 4862赞、COE #10 4610赞）**

```json
{
  "dose_g": 15,
  "grandWater_ratio": 16,
  "grinderSize": 58,
  "rpm": 120,
  "pourList": [
    {"step": "Bloom",  "volume_ml": 50,  "temperature_c": 93, "pause_sec": 28, "pattern": 2},
    {"step": "Pour1",  "volume_ml": 65,  "temperature_c": 93, "pause_sec": 15, "pattern": 2},
    {"step": "Pour2",  "volume_ml": 60,  "temperature_c": 92, "pause_sec": 15, "pattern": 3},
    {"step": "Pour3",  "volume_ml": 55,  "temperature_c": 91, "pause_sec": 12, "pattern": 2},
    {"step": "Pour4",  "volume_ml": 50,  "temperature_c": 90, "pause_sec": 0,  "pattern": 2}
  ]
}
```

**参数逻辑**：
- Bloom 暂停最长（28s），让发酵产生的CO₂充分排出
- 温度适中（93°C），避免过度萃取发酵香气导致杂味
- 注水节奏均匀，不追求极端萃取

**特殊变体（低温厌氧，如 Hacienda La Papaya）**：
- Bloom 温度降至 82°C（低温闷蒸保留发酵香气）
- 后续注水回升至 93°C
- rpm 降至 60（低速研磨减少细粉）

---

### Template D：中深烘日晒美洲豆（Natural Medium-Dark Americas）

**典型豆**：哥伦比亚日晒、洪都拉斯日晒、哥斯达黎加日晒

**参考配方（高赞案例：Honduras Comayagua 4300赞、Perla Negra 2816赞）**

```json
{
  "dose_g": 15,
  "grandWater_ratio": 16,
  "grinderSize": 55,
  "rpm": 120,
  "pourList": [
    {"step": "Bloom",  "volume_ml": 45,  "temperature_c": 92, "pause_sec": 30, "pattern": 2},
    {"step": "Pour1",  "volume_ml": 65,  "temperature_c": 91, "pause_sec": 12, "pattern": 2},
    {"step": "Pour2",  "volume_ml": 60,  "temperature_c": 89, "pause_sec": 8,  "pattern": 2},
    {"step": "Pour3",  "volume_ml": 55,  "temperature_c": 87, "pause_sec": 5,  "pattern": 2},
    {"step": "Pour4",  "volume_ml": 45,  "temperature_c": 85, "pause_sec": 5,  "pattern": 2}
  ]
}
```

**参数逻辑**：
- 明显降温曲线（92→85°C），控制中深烘的苦味
- 全程 circular（pattern 2），均匀萃取，不追求高萃取率
- 较短暂停，避免过度萃取

---

### Template E：中烘水洗美洲豆（Washed Medium Americas）

**典型豆**：哥伦比亚水洗、巴拿马水洗、危地马拉水洗

**参考配方（高赞案例：Panama SL28 3596赞、Colombia San Sebastián 3397赞）**

```json
{
  "dose_g": 15,
  "grandWater_ratio": 16,
  "grinderSize": 59,
  "rpm": 120,
  "pourList": [
    {"step": "Bloom",  "volume_ml": 50,  "temperature_c": 93, "pause_sec": 28, "pattern": 3},
    {"step": "Pour1",  "volume_ml": 60,  "temperature_c": 92, "pause_sec": 18, "pattern": 3},
    {"step": "Pour2",  "volume_ml": 55,  "temperature_c": 91, "pause_sec": 15, "pattern": 2},
    {"step": "Pour3",  "volume_ml": 55,  "temperature_c": 90, "pause_sec": 12, "pattern": 3},
    {"step": "Pour4",  "volume_ml": 50,  "temperature_c": 88, "pause_sec": 0,  "pattern": 3}
  ]
}
```

**参数逻辑**：
- 研磨稍粗（59），中烘豆密度适中
- 螺旋开局（Bloom pattern 3），充分润湿
- 交替 spiral/circular，平衡萃取与清洁度

---

### Template F：脱因豆（EA Decaf / Swiss Water Decaf）

**典型豆**：哥伦比亚EA脱因、尼加拉瓜瑞士水脱因

**参考配方（高赞案例：Tranquilo Francy Castillo Decaf 4997赞）**

```json
{
  "dose_g": 15,
  "grandWater_ratio": 16,
  "grinderSize": 57,
  "rpm": 120,
  "pourList": [
    {"step": "Bloom",  "volume_ml": 42,  "temperature_c": 92, "pause_sec": 17, "pattern": 3},
    {"step": "Pour1",  "volume_ml": 84,  "temperature_c": 91, "pause_sec": 27, "pattern": 2},
    {"step": "Pour2",  "volume_ml": 76,  "temperature_c": 92, "pause_sec": 23, "pattern": 2},
    {"step": "Pour3",  "volume_ml": 38,  "temperature_c": 91, "pause_sec": 0,  "pattern": 3}
  ]
}
```

**参数逻辑**：
- Bloom 比例最低（2.8x），脱因豆细胞结构疏松，吸水快
- 4段式，注水量分布不均匀（大-大-小），类似 Hoffmann 风格
- 温度保持稳定（91–92°C），不大幅降温

---

### Template G：蜜处理豆（Honey Process）

**典型豆**：哥斯达黎加蜜处理、萨尔瓦多蜜处理

```json
{
  "dose_g": 15,
  "grandWater_ratio": 16.5,
  "grinderSize": 55,
  "rpm": 120,
  "pourList": [
    {"step": "Bloom",  "volume_ml": 56,  "temperature_c": 93, "pause_sec": 26, "pattern": 2},
    {"step": "Pour1",  "volume_ml": 60,  "temperature_c": 93, "pause_sec": 15, "pattern": 2},
    {"step": "Pour2",  "volume_ml": 55,  "temperature_c": 92, "pause_sec": 14, "pattern": 2},
    {"step": "Pour3",  "volume_ml": 50,  "temperature_c": 91, "pause_sec": 12, "pattern": 3},
    {"step": "Pour4",  "volume_ml": 47,  "temperature_c": 90, "pause_sec": 10, "pattern": 3},
    {"step": "Pour5",  "volume_ml": 44,  "temperature_c": 89, "pause_sec": 0,  "pattern": 2}
  ]
}
```

**参数逻辑**：
- Bloom 比例最高（3.7x），蜜处理果胶层吸水性强
- 6段式，段数最多，充分萃取蜜处理的甜感层次
- 研磨偏细（55），蜜处理豆密度介于水洗和日晒之间

---

## 五、参数调整速查表

### 5.1 口感问题 → 参数调整

| 问题 | 调整方向 |
|------|---------|
| 太苦/涩 | grind +3–5（粗），temp -2°C，减少 spiral pattern |
| 太酸/尖锐 | grind -3–5（细），temp +2°C，增加 spiral pattern |
| 太淡/水感 | ratio +1（如16→17），grind -3，增加段数 |
| 太浓/厚重 | ratio -1（如16→15），grind +3，减少段数 |
| 香气不足 | temp +2°C，Bloom 暂停 +5s，增加 spiral |
| 甜感不足 | 降温曲线更明显，后段用 centered(1) |
| 层次感差 | 增加段数（4→5），加大段间温差 |

### 5.2 豆子特征 → 参数倾向

| 豆子特征 | 参数倾向 |
|---------|---------|
| 高海拔（>1800m）| grind -3（更细），temp +1°C |
| 低海拔（<1200m）| grind +3（更粗），temp -1°C |
| 新鲜豆（<2周）| Bloom 暂停 +10s，Bloom 比例 +0.3x |
| 老豆（>6个月）| Bloom 暂停 -5s，temp +1°C |
| 浅烘高密度 | grind -5，rpm 可降至 80–100 |
| 深烘低密度 | grind +5，temp -2°C |

### 5.3 RPM 选择逻辑

| rpm | 适用场景 |
|-----|---------|
| 120 | 通用，绝大多数豆子 |
| 80–100 | 精品豆（肯尼亚AA、巴拿马瑰夏），减少细粉 |
| 60 | 极品豆，最大程度保留风味完整性 |

---

## 六、快速推演流程

当收到新豆信息时，按以下步骤推演初始配方：

```
1. 确定 roast → 查表得基准 grinderSize、temperature、ratio
2. 确定 process → 查表得 Bloom 比例和暂停时间
3. 确定 origin → 判断豆子特征（非洲高酸/美洲甜感/亚洲醇厚）
4. 选择段数 → 浅烘复杂豆用5段，中深烘简单豆用4段
5. 选择 pattern 序列 → 浅烘多用 spiral，深烘多用 circular
6. 计算各段注水量 → 总水量 = dose × ratio，按比例分配
7. 设计温度曲线 → 浅烘平温或微降，深烘明显降温
```

---

## 七、振动参数规律（isEnableVibrationBefore / isEnableVibrationAfter）

> 数据来源：449条配方（recipes_v2.json），字段编码：**1 = ON（启用），2 = OFF（关闭）**

### 7.1 整体使用率

| 指标 | 数值 |
|------|------|
| 含任意振动的配方 | 371/449（82.6%） |
| 含 VibrationBefore 的配方 | 142/449（31.6%） |
| 含 VibrationAfter 的配方 | 347/449（77.3%） |
| 段级 VibBefore=ON | 192/1933（9.9%） |
| 段级 VibAfter=ON | 701/1933（36.3%） |

**核心结论：振动以"注水后"为主，VibAfter 使用率是 VibBefore 的 3.7 倍。振动的主要作用是注水后促进粉层均匀浸润，而非注水前松粉。**

### 7.2 各段振动使用率（U形分布）

| 段 | 样本数 | VibBefore% | VibAfter% |
|----|--------|-----------|----------|
| 0（Bloom） | 448 | 18.3% | **72.5%** |
| 1 | 448 | 6.0% | 24.8% |
| 2 | 446 | 7.4% | 23.8% |
| 3 | 369 | 6.2% | 19.5% |
| 4 | 169 | 16.0% | **47.9%** |
| 5+ | <31 | 0.0% | ~12% |

**规律：Bloom 段 VibAfter 高达 72.5%，最后大注水段（index=4）回升至 47.9%，中间段最低——形成"首尾高、中间低"的 U 形分布。**

### 7.3 振动 × 烘焙度

| 烘焙度 | 配方数 | 配方级 VibAfter% | 段级 VibAfter% |
|--------|--------|----------------|--------------|
| 浅焙(1) | 227 | 77.1% | 39.3% |
| 中浅焙(2) | 80 | 72.5% | 28.2% |
| 中深焙(3) | 64 | 81.2% | 39.3% |
| 深焙(4) | 8 | 87.5% | 32.4% |
| 极深焙(5) | 9 | **100.0%** | 31.7% |

**规律：VibAfter 随烘焙度加深而增加，极深焙 100% 含 After 振动。深烘豆依赖振动促进萃取。**

### 7.4 振动 × 处理法

| 处理法 | 配方数 | 配方级 VibBefore% | 配方级 VibAfter% | 段级 VibAfter% |
|--------|--------|-----------------|----------------|--------------|
| 水洗 | 125 | 26.4% | 72.8% | 31.6% |
| 日晒 | 95 | **34.7%** | 72.6% | 38.1% |
| 厌氧 | 75 | 17.3% | **88.0%** | 37.8% |
| 蜜处理 | 23 | 21.7% | 78.3% | **43.5%** |

**规律：**
- **厌氧豆**：VibAfter 最高（88%），VibBefore 最低（17.3%）——厌氧豆风味复杂，用"注水后振动"促进均匀萃取，不用注水前振动
- **日晒豆**：VibBefore 最高（34.7%），可能因为日晒豆颗粒干燥，需要注水前振动松动粉层
- **蜜处理**：段级 VibAfter 最高（43.5%）

### 7.5 振动 × Pattern

| Pattern | 段数 | VibBefore% | VibAfter% |
|---------|------|-----------|----------|
| circular | 1142 | 11.2% | **44.8%** |
| spiral | 527 | 10.6% | 30.6% |
| centered | 264 | 3.0% | 10.6% |

**规律：circular 与振动高度绑定（VibAfter=44.8%）；centered 几乎不用振动（10.6%）——centered 本身是最温和的注水方式，不需要额外振动。**

### 7.6 振动 × 流速（慢注+振动组合策略）

| 条件 | 平均水温 | 平均流速 |
|------|---------|---------|
| VibAfter=ON | 92.52°C | **3.315 ml/s** |
| VibAfter=OFF | 91.18°C | **3.391 ml/s** |

**规律：VibAfter=ON 时流速反而更低（3.315 vs 3.391）。这是一种"慢注水 + 振动"的组合策略，用振动补充搅拌来替代快速注水的扰动效果。**

### 7.7 最高频振动序列

**After 振动 Top 序列：**

| 序列 | 出现次数 | 占比 |
|------|---------|------|
| `(A,-,-,-)` 仅 Bloom 段 After | 71 | 15.8% |
| `(A,-,-,-,A)` Bloom + 最后段 | 42 | 9.4% |
| `(A,-,A)` Bloom + 第3段 | 35 | 7.8% |
| `(-,-,-,-)` 全程无振动 | 45 | 10.0% |

**最常见模式：Bloom 段 After 振动 + 中间段无振动 + 可选最后段 After 振动。**

### 7.8 振动 × 产地

| 产地 | 段级 VibBefore% | 段级 VibAfter% |
|------|---------------|--------------|
| 美洲 | 8.4% | **40.1%** |
| 非洲 | 7.4% | 30.2% |
| 亚洲 | **13.6%** | 23.9% |

**国家亮点：**
- **巴拿马**（多为瑰夏）：VibAfter=55.2%，最高
- **哥斯达黎加**：VibAfter=46.8%
- **印尼**：VibBefore=18.4%，主要产地中最高，但 VibAfter 仅 13.2%——亚洲豆偏好注水前振动

### 7.9 振动参数推演规则

在推演新豆配方时，按以下逻辑决定振动参数：

```
Bloom 段：
  - 几乎总是加 VibAfter=ON（72.5%基准）
  - 日晒豆可加 VibBefore=ON（松动干燥粉层）

中间段（Pour1~Pour3）：
  - 默认 VibBefore=OFF, VibAfter=OFF
  - 厌氧/蜜处理豆可在 Pour1 加 VibAfter=ON

最后大注水段（Pour4/最后段）：
  - 深烘豆加 VibAfter=ON（47.9%基准）
  - 浅烘豆可选加（约30%概率）

Pattern 联动：
  - circular 段优先考虑加 VibAfter
  - centered 段不加振动
  - spiral 段可选加 VibAfter

流速联动：
  - 加了 VibAfter 的段，流速可设为 3.0–3.3（偏慢）
  - 不加振动的段，流速可设为 3.3–3.5（偏快）
```

---

## 八、数据置信度说明

| 规律 | 置信度 | 依据 |
|------|--------|------|
| 烘焙度→研磨度 | 高 | 397条有效样本，统计显著 |
| 烘焙度→水温 | 高 | 全量数据，趋势明确 |
| 处理法→Bloom参数 | 中高 | 分类后样本量充足 |
| Pattern序列规律 | 中 | 存在较大个体差异 |
| RPM选择 | 中 | 120rpm占主导，其他rpm规律性弱 |

---

*本知识库基于 xBloom 官方配方数据集分析生成，应结合实际冲煮反馈持续迭代。*
