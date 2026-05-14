import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as api from "./xbloom-api.js";
import * as store from "./store.js";

export function registerTools(server: McpServer): void {
  // --- Auth ---

  server.tool(
    "xbloom_login",
    "Log in to XBloom. Required once — token is saved locally.",
    { email: z.string(), password: z.string() },
    async ({ email, password }) => {
      const creds = await api.login(email, password);
      await store.saveConfig(creds);
      return { content: [{ type: "text", text: `Logged in as ${creds.email}. Token saved to ~/.xbloom/config.json.` }] };
    },
  );

  // --- Cloud recipe management ---

  server.tool(
    "xbloom_list_recipes",
    "List all recipes on your XBloom account.",
    {},
    async () => {
      const creds = await requireAuth();
      const result = await api.listRecipes(creds);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "xbloom_create_recipe",
    "Create a coffee recipe and push to XBloom cloud.",
    {
      name: z.string(),
      dose_g: z.number().min(1).max(31),
      ratio: z.number(),
      grind_size: z.number().min(40).max(120),
      grind_rpm: z.number().min(60).max(120),
      pours: z.array(z.object({
        volume_ml: z.number(),
        temperature_c: z.number().min(40).max(95),
        pattern: z.enum(["centered", "circular", "spiral"]),
        flow_rate: z.number().min(3.0).max(3.5),
        pause_seconds: z.number().int().min(0).max(255),
        agitate_before: z.boolean().optional(),
        agitate_after: z.boolean().optional(),
      })),
      color: z.string().optional(),
    },
    async (args) => {
      const creds = await requireAuth();
      const result = await api.createRecipe(creds, args);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "xbloom_create_tea_recipe",
    "Create a tea recipe for the Omni Tea Brewer.",
    {
      name: z.string(),
      dose_g: z.number().min(1).max(10),
      ratio: z.number(),
      steeps: z.array(z.object({
        volume_ml: z.number().max(90).optional(),
        temperature_c: z.number().min(65).max(100).optional(),
        steep_seconds: z.number().int().min(0).max(360).optional(),
        flow_rate: z.number().optional(),
      })).max(3),
      color: z.string().optional(),
    },
    async (args) => {
      const creds = await requireAuth();
      const result = await api.createTeaRecipe(creds, args);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "xbloom_edit_recipe",
    "Edit an existing recipe. Only pass fields to change.",
    {
      recipe_id: z.number().int(),
      name: z.string().optional(),
      dose_g: z.number().optional(),
      ratio: z.number().optional(),
      grind_size: z.number().optional(),
      grind_rpm: z.number().optional(),
      pours: z.array(z.object({
        volume_ml: z.number(),
        temperature_c: z.number(),
        pattern: z.enum(["centered", "circular", "spiral"]),
        flow_rate: z.number(),
        pause_seconds: z.number().int(),
        agitate_before: z.boolean().optional(),
        agitate_after: z.boolean().optional(),
      })).optional(),
      color: z.string().optional(),
    },
    async (args) => {
      const creds = await requireAuth();
      const result = await api.editRecipe(creds, args);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "xbloom_delete_recipe",
    "Delete a recipe permanently.",
    { recipe_id: z.number().int() },
    async ({ recipe_id }) => {
      const creds = await requireAuth();
      const result = await api.deleteRecipe(creds, recipe_id);
      return { content: [{ type: "text", text: result }] };
    },
  );

  server.tool(
    "xbloom_fetch_recipe",
    "Fetch a recipe from a share URL.",
    { share_url: z.string() },
    async ({ share_url }) => {
      const result = await api.fetchRecipe(share_url);
      return { content: [{ type: "text", text: result }] };
    },
  );

  // --- Local data tools ---

  server.tool(
    "xbloom_get_preferences",
    "Read saved taste preferences.",
    {},
    async () => {
      const prefs = await store.getPreferences();
      if (!prefs) return { content: [{ type: "text", text: "No preferences saved yet." }] };
      return { content: [{ type: "text", text: JSON.stringify(prefs, null, 2) }] };
    },
  );

  server.tool(
    "xbloom_save_preferences",
    "Save or update taste preferences.",
    {
      acidity: z.string().describe("Preferred acidity level (e.g. bright, balanced, low)"),
      sweetness: z.string().describe("Preferred sweetness (e.g. high, medium, subtle)"),
      body: z.string().describe("Preferred body (e.g. light, medium, full)"),
      strength: z.string().describe("Preferred strength (e.g. light, medium, strong)"),
      notes: z.string().describe("Additional preference notes"),
    },
    async (args) => {
      await store.savePreferences({ ...args, updatedAt: new Date().toISOString() });
      return { content: [{ type: "text", text: "Preferences saved." }] };
    },
  );

  server.tool(
    "xbloom_get_beans",
    "Read the bean library.",
    {},
    async () => {
      const beans = await store.getBeans();
      if (!beans.length) return { content: [{ type: "text", text: "No beans saved yet." }] };
      return { content: [{ type: "text", text: JSON.stringify(beans, null, 2) }] };
    },
  );

  server.tool(
    "xbloom_save_bean",
    "Add or update a bean in the library.",
    {
      id: z.string().optional().describe("Bean ID to update. Omit to create new."),
      name: z.string(),
      origin: z.string(),
      process: z.string().describe("washed, natural, honey, anaerobic, etc."),
      roastLevel: z.string().describe("light, medium-light, medium, medium-dark, dark"),
      altitude: z.string().optional(),
      flavorNotes: z.string().optional(),
      roastDate: z.string().optional(),
    },
    async (args) => {
      const beans = await store.getBeans();
      const id = args.id || `bean_${Date.now()}`;
      const idx = beans.findIndex(b => b.id === id);
      const bean: store.Bean = { ...args, id, addedAt: new Date().toISOString() };
      if (idx >= 0) beans[idx] = bean;
      else beans.push(bean);
      await store.saveBeans(beans);
      return { content: [{ type: "text", text: `Bean '${args.name}' saved (${id}).` }] };
    },
  );

  server.tool(
    "xbloom_delete_bean",
    "Remove a bean from the library.",
    { id: z.string() },
    async ({ id }) => {
      const beans = await store.getBeans();
      const filtered = beans.filter(b => b.id !== id);
      if (filtered.length === beans.length) {
        return { content: [{ type: "text", text: `Bean '${id}' not found.` }] };
      }
      await store.saveBeans(filtered);
      return { content: [{ type: "text", text: `Bean '${id}' removed.` }] };
    },
  );

  server.tool(
    "xbloom_get_history",
    "Read brewing history. Returns recent entries.",
    { limit: z.number().int().optional().describe("Max entries to return (default 20)") },
    async ({ limit }) => {
      const history = await store.getHistory();
      if (!history.length) return { content: [{ type: "text", text: "No brewing history yet." }] };
      const entries = history.slice(-(limit ?? 20));
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    },
  );

  server.tool(
    "xbloom_save_history",
    "Save a brewing record with recipe params and optional feedback.",
    {
      beanId: z.string().optional(),
      beanName: z.string().optional(),
      recipeName: z.string(),
      recipeId: z.number().int().optional(),
      params: z.object({
        dose_g: z.number(),
        ratio: z.number(),
        grind_size: z.number(),
        grind_rpm: z.number(),
        pours: z.array(z.object({
          volume_ml: z.number(),
          temperature_c: z.number(),
          pattern: z.string(),
          flow_rate: z.number(),
          pause_seconds: z.number(),
        })),
      }),
      feedback: z.string().optional(),
      rating: z.number().min(1).max(10).optional(),
    },
    async (args) => {
      const history = await store.getHistory();
      const entry: store.HistoryEntry = {
        id: `brew_${Date.now()}`,
        ...args,
        brewedAt: new Date().toISOString(),
      };
      history.push(entry);
      await store.saveHistory(history);
      return { content: [{ type: "text", text: `Brew recorded (${entry.id}).` }] };
    },
  );

  server.tool(
    "xbloom_get_water",
    "Read saved water profile.",
    {},
    async () => {
      const water = await store.getWater();
      if (!water) return { content: [{ type: "text", text: "No water profile saved yet." }] };
      return { content: [{ type: "text", text: JSON.stringify(water, null, 2) }] };
    },
  );

  server.tool(
    "xbloom_save_water",
    "Save water quality profile.",
    {
      tds: z.number().optional(),
      calcium: z.number().optional(),
      magnesium: z.number().optional(),
      alkalinity: z.number().optional(),
      ph: z.number().optional(),
      source: z.string().describe("Water source description"),
    },
    async (args) => {
      await store.saveWater({ ...args, updatedAt: new Date().toISOString() });
      return { content: [{ type: "text", text: "Water profile saved." }] };
    },
  );
}

async function requireAuth(): Promise<api.XBloomCreds> {
  const config = await store.getConfig();
  if (!config) {
    throw new Error("Not logged in. Use xbloom_login with your XBloom email and password first.");
  }
  return config;
}
