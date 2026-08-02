---
name: beans
description: "Manage your coffee bean library — add, edit, remove beans; track roast freshness and brew stats."
---

# Bean Library

Manage the local coffee bean library stored at `~/.xbloom/beans.json` via the xbloom MCP tools.

## Current Beans

Call `xbloom_get_beans` to list all beans (id, name, origin, process, roast level, altitude, flavor notes, roast date, brew stats).

## Freshness Check（每次查看或使用豆库时执行）

根据 `roastDate` 计算豆龄并给出状态：

- 浅烘：养豆 7-14 天，最佳窗口 7-21 天
- 中烘：养豆 5-10 天，最佳窗口 7-21 天
- 中深/深烘：养豆 2-5 天，最佳窗口 7-21 天
- 21-35 天（rested）：开始衰减，可略调细研磨补偿
- 35-60 天（aging）：研磨调细 3-5 格、闷蒸缩短到 25-30s、水温适当提高
- 60+ 天（stale）：风味基本流失，明确提示用户，建议尽快饮用或换新豆

对超出最佳窗口的豆子，出配方时必须先提示豆龄，再按上述规则修正参数（参考 `data/brewing-reference.md` 4.4 节）。

## Actions

- **Add**: Collect bean info and call `xbloom_save_bean`
  - Required: name, origin, process (washed/natural/honey/anaerobic/special_fermented), roast level
  - Optional: altitude, flavor notes, roast date
- **Edit**: Call `xbloom_save_bean` with existing `id` and only the fields to change（未传字段保留原值）
- **Remove**: Call `xbloom_delete_bean` with the bean id
- **Photo**: If user provides a photo of a coffee bag, read the label and extract bean info

## Brew Stats

`brewCount`、`lastBrewedAt`、`lastRating` 由 `xbloom_save_history` 在记录冲煮/反馈时自动回写，不需要手动维护。
