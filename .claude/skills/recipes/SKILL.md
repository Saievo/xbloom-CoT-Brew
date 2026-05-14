---
name: recipes
description: "List, edit, delete, or import XBloom recipes from the cloud."
---

# Manage Recipes

Manage recipes on the user's XBloom cloud account.

## Auth Check

!`test -f ~/.xbloom/config.json && echo "Logged in." || echo "NOT LOGGED IN — ask user for XBloom email/password and call xbloom_login first."`

## Available Actions

- **List**: Call `xbloom_list_recipes` to show all recipes with IDs
- **Edit**: Call `xbloom_edit_recipe` with recipe_id and fields to change
- **Delete**: Call `xbloom_delete_recipe` with recipe_id (confirm with user first)
- **Import**: Call `xbloom_fetch_recipe` with a share URL, then optionally create it

## User Input

$ARGUMENTS
