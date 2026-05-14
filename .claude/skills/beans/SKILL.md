---
name: beans
description: "Manage your coffee bean library — add, edit, remove beans."
---

# Bean Library

Manage the local coffee bean library stored at ~/.xbloom/beans.json.

## Current Beans

!`cat ~/.xbloom/beans.json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const b=JSON.parse(d);b.forEach(x=>console.log('- ['+x.id+'] '+x.name+' | '+x.origin+' | '+x.process+' | '+x.roastLevel+(x.altitude?' | '+x.altitude:'')+(x.flavorNotes?' | '+x.flavorNotes:'')+(x.roastDate?' | roasted '+x.roastDate:'')))" 2>/dev/null || echo "No beans saved yet."`

## Actions

- **Add**: Collect bean info and call `xbloom_save_bean`
  - Required: name, origin, process (washed/natural/honey/anaerobic), roast level
  - Optional: altitude, flavor notes, roast date
- **Edit**: Call `xbloom_save_bean` with existing id and updated fields
- **Remove**: Call `xbloom_delete_bean` with the bean id
- **Photo**: If user provides a photo of a coffee bag, read the label and extract bean info

## User Input

$ARGUMENTS
