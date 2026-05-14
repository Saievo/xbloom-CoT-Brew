---
name: taste
description: "Record brewing feedback, update preferences, and iterate on recipes."
---

# Taste & Feedback

Record how a brew tasted and use the feedback to improve future recipes.

## Recent Brews

!`cat ~/.xbloom/history.json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const h=JSON.parse(d).slice(-5);h.forEach((x,i)=>console.log((i+1)+'. ['+x.id+'] '+x.recipeName+' ('+x.brewedAt.slice(0,10)+') '+(x.feedback||'no feedback')+(x.rating?' rating:'+x.rating:'')))" 2>/dev/null || echo "No brewing history yet. Use /brew first."`

## Current Preferences

!`cat ~/.xbloom/preferences.json 2>/dev/null || echo "No preferences saved yet."`

## Workflow

1. Ask which brew they're rating (default: most recent)
2. Collect feedback: taste notes, what to improve (too bitter/sour/weak/strong), rating 1-10
3. Update the history entry with `xbloom_save_history`
4. Analyze feedback patterns across history and update preferences with `xbloom_save_preferences`
5. Suggest specific recipe adjustments based on the brewing reference:
   - Too bitter → coarser grind, lower temp, less agitation
   - Too sour → finer grind, higher temp, more agitation
   - Too weak → higher ratio, finer grind, more pours
   - Too strong → lower ratio, coarser grind, fewer pours
6. Optionally create an improved recipe with /brew

## User Input

$ARGUMENTS
