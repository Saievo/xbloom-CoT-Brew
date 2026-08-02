---
name: recipes
description: "List, edit, delete, or import XBloom recipes from the cloud."
---

# Manage Recipes

Manage recipes on the user's XBloom cloud account.

## Auth Check

云端工具报错只要包含 "Not logged in"、"session expired"、"身份验证已过期"、"请重新登录" 等字样，立即停下：向用户索要 XBloom 邮箱和密码，调用 `xbloom_login` 登录成功后再重试原操作。

## Available Actions

- **List**: Call `xbloom_list_recipes` to show all recipes with IDs
- **Edit**: Call `xbloom_edit_recipe` with recipe_id and fields to change
- **Delete**: Call `xbloom_delete_recipe` with recipe_id (confirm with user first)
- **Import**: Call `xbloom_fetch_recipe` with a share URL, then optionally create it

以用户当前请求为准执行相应操作。
