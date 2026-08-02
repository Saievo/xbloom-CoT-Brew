---
name: recipes
description: "List, edit, delete, or import XBloom recipes from the cloud."
---

# Manage Recipes

Manage recipes on the user's XBloom cloud account.

## Auth Check

云端工具（`xbloom_list_recipes` / `xbloom_create_recipe` / `xbloom_edit_recipe` / `xbloom_delete_recipe`）报 "Not logged in" 时，询问用户 XBloom 邮箱和密码，调用 `xbloom_login` 后再重试。

## Available Actions

- **List**: Call `xbloom_list_recipes` to show all recipes with IDs
- **Edit**: Call `xbloom_edit_recipe` with recipe_id and fields to change
- **Delete**: Call `xbloom_delete_recipe` with recipe_id (confirm with user first)
- **Import**: Call `xbloom_fetch_recipe` with a share URL, then optionally create it

以用户当前请求为准执行相应操作。
