package com.jeimcp.bridge.http;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import net.minecraft.client.Minecraft;
import net.minecraft.item.ItemStack;
import net.minecraft.util.text.ITooltipFlag;

import mezz.jei.api.IJeiRuntime;
import mezz.jei.api.ingredients.IIngredientHelper;
import mezz.jei.api.ingredients.IIngredientRegistry;
import mezz.jei.api.ingredients.VanillaTypes;
import mezz.jei.api.recipe.IFocus;
import mezz.jei.api.recipe.IRecipeCategory;
import mezz.jei.api.recipe.IRecipeRegistry;
import mezz.jei.api.recipe.IRecipeWrapper;
import mezz.jei.api.ingredients.IIngredients;
import mezz.jei.ingredients.Ingredients;

import com.jeimcp.bridge.JeiMcpBridgePlugin;
import com.jeimcp.bridge.JeiDataCache;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.util.*;
import java.util.concurrent.*;

public class JeiHttpBridgeServer {
    public static final int PORT = 18732;

    private static final Logger LOG = LogManager.getLogger("jei_mcp_bridge");
    private static final Gson GSON = new GsonBuilder().create();

    private HttpServer server;
    private final ExecutorService httpThreadPool = Executors.newFixedThreadPool(4);

    public void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", PORT), 0);
        server.createContext("/api/health", new HealthHandler());
        server.createContext("/api/items/search", new SearchItemsHandler());
        server.createContext("/api/items/all", new ListAllItemsHandler());
        server.createContext("/api/items/count", new ItemCountHandler());
        server.createContext("/api/items/", new ItemDetailOrRecipesHandler());
        server.createContext("/api/categories", new CategoriesHandler());
        server.setExecutor(httpThreadPool);
        server.start();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
            httpThreadPool.shutdown();
        }
    }

    private static <T> CompletableFuture<T> runOnMainThread(Callable<T> task) {
        CompletableFuture<T> future = new CompletableFuture<>();
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null) {
            future.completeExceptionally(new RuntimeException("Minecraft not available"));
            return future;
        }
        minecraft.addScheduledTask(() -> {
            try {
                future.complete(task.call());
            } catch (Exception e) {
                future.completeExceptionally(e);
            }
        });
        return future;
    }

    private static void requireRuntime() {
        if (!JeiMcpBridgePlugin.isRuntimeAvailable()) {
            throw new RuntimeException("JEI runtime not available yet");
        }
    }

    private static void sendJson(HttpExchange exchange, Object data) throws Exception {
        String json = GSON.toJson(data);
        byte[] bytes = json.getBytes("UTF-8");
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static void sendError(HttpExchange exchange, int code, String message) throws Exception {
        Map<String, Object> err = new HashMap<>();
        err.put("error", message);
        String json = GSON.toJson(err);
        byte[] bytes = json.getBytes("UTF-8");
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> params = new HashMap<>();
        if (query == null || query.isEmpty()) return params;
        for (String part : query.split("&")) {
            String[] kv = part.split("=", 2);
            try {
                String key = URLDecoder.decode(kv[0], "UTF-8");
                String val = kv.length > 1 ? URLDecoder.decode(kv[1], "UTF-8") : "";
                params.put(key, val);
            } catch (Exception e) {
                LOG.warn("Failed to decode query param: {}", part);
            }
        }
        return params;
    }

    private static <T> T withMainThread(Callable<T> task, HttpExchange exchange) throws Exception {
        return runOnMainThread(() -> {
            try {
                return task.call();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        }).get(30, TimeUnit.SECONDS);
    }

    private static void handleInMainThread(HttpExchange exchange, ThrowingConsumer<HttpExchange> handler) {
        try {
            requireRuntime();
            runOnMainThread(() -> {
                try {
                    requireRuntime();
                    handler.accept(exchange);
                } catch (Exception e) {
                    try { sendError(exchange, 500, "Internal error: " + e.getMessage()); } catch (Exception ignored) {}
                    LOG.error("Handler error", e);
                }
                return null;
            }).get(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            try { sendError(exchange, 500, "Internal error: " + e.getMessage()); } catch (Exception ignored) {}
        }
    }

    @FunctionalInterface
    private interface ThrowingConsumer<T> {
        void accept(T t) throws Exception;
    }

    static class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws Exception {
            if (!"GET".equals(exchange.getRequestMethod())) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }
            Map<String, Object> resp = new HashMap<>();
            resp.put("status", "ok");
            resp.put("jei_runtime", JeiMcpBridgePlugin.isRuntimeAvailable());
            resp.put("item_count", JeiMcpBridgePlugin.isRuntimeAvailable()
                ? JeiMcpBridgePlugin.getDataCache().getTotalCount() : 0);
            sendJson(exchange, resp);
        }
    }

    static class SearchItemsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws Exception {
            if (!"GET".equals(exchange.getRequestMethod())) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }
            Map<String, String> params = parseQuery(exchange.getRequestURI().getQuery());
            String query = params.getOrDefault("q", "");
            int limit = Math.min(Integer.parseInt(params.getOrDefault("limit", "50")), 500);
            int offset = Integer.parseInt(params.getOrDefault("offset", "0"));

            if (query.isEmpty()) {
                sendError(exchange, 400, "Missing query parameter 'q'");
                return;
            }

            String finalQuery = query;
            int finalLimit = limit;
            int finalOffset = offset;

            handleInMainThread(exchange, (ex) -> {
                requireRuntime();
                JeiDataCache cache = JeiMcpBridgePlugin.getDataCache();
                int total = cache.searchCount(finalQuery);
                List<Map<String, Object>> results = cache.search(finalQuery, finalOffset, finalLimit);

                Map<String, Object> response = new HashMap<>();
                response.put("total", total);
                response.put("offset", finalOffset);
                response.put("limit", finalLimit);
                response.put("results", results);
                sendJson(ex, response);
            });
        }
    }

    static class ListAllItemsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws Exception {
            if (!"GET".equals(exchange.getRequestMethod())) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }
            Map<String, String> params = parseQuery(exchange.getRequestURI().getQuery());
            int limit = Math.min(Integer.parseInt(params.getOrDefault("limit", "200")), 5000);
            int offset = Integer.parseInt(params.getOrDefault("offset", "0"));

            int finalLimit = limit;
            int finalOffset = offset;

            handleInMainThread(exchange, (ex) -> {
                requireRuntime();
                JeiDataCache cache = JeiMcpBridgePlugin.getDataCache();

                Map<String, Object> response = new HashMap<>();
                response.put("total", cache.getTotalCount());
                response.put("offset", finalOffset);
                response.put("limit", finalLimit);
                response.put("results", cache.getPageDetails(finalOffset, finalLimit));
                sendJson(ex, response);
            });
        }
    }

    static class ItemCountHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws Exception {
            if (!"GET".equals(exchange.getRequestMethod())) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }

            handleInMainThread(exchange, (ex) -> {
                requireRuntime();
                JeiDataCache cache = JeiMcpBridgePlugin.getDataCache();
                Map<String, Object> resp = new HashMap<>();
                resp.put("count", cache.getTotalCount());
                sendJson(ex, resp);
            });
        }
    }

    static class ItemDetailOrRecipesHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws Exception {
            if (!"GET".equals(exchange.getRequestMethod())) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }

            String path = exchange.getRequestURI().getPath();
            String itemPath = path.replace("/api/items/", "");
            boolean isRecipes = itemPath.endsWith("/recipes");
            boolean isUses = itemPath.endsWith("/uses");
            String uid = itemPath;
            if (isRecipes) uid = itemPath.substring(0, itemPath.length() - "/recipes".length());
            else if (isUses) uid = itemPath.substring(0, itemPath.length() - "/uses".length());

            String finalUid = uid;
            boolean finalIsRecipes = isRecipes;
            boolean finalIsUses = isUses;

            handleInMainThread(exchange, (ex) -> {
                requireRuntime();
                JeiDataCache cache = JeiMcpBridgePlugin.getDataCache();
                JeiDataCache.CacheEntry entry = cache.findEntryByUid(finalUid);

                if (entry == null) {
                    sendError(ex, 404, "Item not found: " + finalUid);
                    return;
                }

                if (!finalIsRecipes && !finalIsUses) {
                    IIngredientHelper<ItemStack> helper = cache.getHelper();
                    List<String> tooltip = Collections.emptyList();
                    try {
                        Minecraft mc = Minecraft.getMinecraft();
                        if (mc.player != null) {
                            ITooltipFlag flag = mc.gameSettings.advancedItemTooltips
                                ? ITooltipFlag.TooltipFlags.ADVANCED
                                : ITooltipFlag.TooltipFlags.NORMAL;
                            tooltip = entry.getStack().getTooltip(mc.player, flag);
                        }
                    } catch (Exception ignored) {}

                    List<String> oreDict = new ArrayList<>();
                    for (String ore : helper.getOreDictNames(entry.getStack())) {
                        oreDict.add(ore);
                    }
                    List<String> creativeTabs = new ArrayList<>();
                    for (String tab : helper.getCreativeTabNames(entry.getStack())) {
                        creativeTabs.add(tab);
                    }

                    sendJson(ex, JeiDataCache.detailMap(entry, tooltip, oreDict, creativeTabs));
                    return;
                }

                IJeiRuntime runtime = JeiMcpBridgePlugin.getJeiRuntime();
                IRecipeRegistry recipeRegistry = runtime.getRecipeRegistry();
                IFocus.Mode mode = finalIsRecipes ? IFocus.Mode.OUTPUT : IFocus.Mode.INPUT;
                IFocus<ItemStack> focus = recipeRegistry.createFocus(mode, entry.getStack());
                List<IRecipeCategory> categories = recipeRegistry.getRecipeCategories(focus);

                List<Map<String, Object>> recipesList = new ArrayList<>();
                for (IRecipeCategory<?> category : categories) {
                    List wrappers = recipeRegistry.getRecipeWrappers(category, focus);
                    for (Object obj : wrappers) {
                        IRecipeWrapper wrapper = (IRecipeWrapper) obj;
                        IIngredients ingredients = new Ingredients();
                        wrapper.getIngredients(ingredients);

                        Map<String, Object> recipeData = new HashMap<>();
                        recipeData.put("categoryUid", category.getUid());
                        recipeData.put("categoryTitle", category.getTitle());
                        recipeData.put("categoryModName", category.getModName());
                        recipeData.put("inputs", convertStacks(ingredients.getInputs(VanillaTypes.ITEM)));
                        recipeData.put("outputs", convertStacks(ingredients.getOutputs(VanillaTypes.ITEM)));
                        recipesList.add(recipeData);
                    }
                }

                Map<String, Object> response = new HashMap<>();
                response.put("uid", entry.getUid());
                response.put("displayName", entry.getDisplayName());
                response.put("mode", finalIsRecipes ? "recipes" : "uses");
                response.put("count", recipesList.size());
                response.put("recipes", recipesList);
                sendJson(ex, response);
            });
        }
    }

    static class CategoriesHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws Exception {
            if (!"GET".equals(exchange.getRequestMethod())) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }

            handleInMainThread(exchange, (ex) -> {
                requireRuntime();
                IJeiRuntime runtime = JeiMcpBridgePlugin.getJeiRuntime();
                IRecipeRegistry registry = runtime.getRecipeRegistry();
                List<IRecipeCategory> categories = registry.getRecipeCategories();

                List<Map<String, Object>> result = new ArrayList<>();
                for (IRecipeCategory<?> cat : categories) {
                    Map<String, Object> c = new HashMap<>();
                    c.put("uid", cat.getUid());
                    c.put("title", cat.getTitle());
                    c.put("modName", cat.getModName());
                    result.add(c);
                }

                Map<String, Object> resp = new HashMap<>();
                resp.put("categories", result);
                resp.put("count", result.size());
                sendJson(ex, resp);
            });
        }
    }

    private static List<List<Map<String, Object>>> convertStacks(List<List<ItemStack>> stacks) {
        if (stacks == null) return Collections.emptyList();
        List<List<Map<String, Object>>> result = new ArrayList<>();
        for (List<ItemStack> altList : stacks) {
            List<Map<String, Object>> converted = new ArrayList<>();
            for (ItemStack stack : altList) {
                if (!stack.isEmpty()) {
                    Map<String, Object> s = new HashMap<>();
                    s.put("registryName", stack.getItem().getRegistryName().toString());
                    s.put("displayName", stack.getDisplayName());
                    s.put("count", stack.getCount());
                    s.put("metadata", stack.getMetadata());
                    converted.add(s);
                }
            }
            result.add(converted);
        }
        return result;
    }
}
