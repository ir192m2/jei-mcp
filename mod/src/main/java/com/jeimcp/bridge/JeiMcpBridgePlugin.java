package com.jeimcp.bridge;

import javax.annotation.Nonnull;

import mezz.jei.api.IJeiRuntime;
import mezz.jei.api.IModPlugin;
import mezz.jei.api.IModRegistry;
import mezz.jei.api.JEIPlugin;
import mezz.jei.api.ingredients.IIngredientRegistry;

import com.jeimcp.bridge.http.JeiHttpBridgeServer;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

@JEIPlugin
public class JeiMcpBridgePlugin implements IModPlugin {
    private static final Logger LOG = LogManager.getLogger("jei_mcp_bridge");

    private static volatile IJeiRuntime jeiRuntime;
    private static volatile IIngredientRegistry ingredientRegistry;
    private static volatile JeiDataCache dataCache;
    private JeiHttpBridgeServer httpServer;

    public static IJeiRuntime getJeiRuntime() {
        return jeiRuntime;
    }

    public static IIngredientRegistry getIngredientRegistry() {
        return ingredientRegistry;
    }

    public static JeiDataCache getDataCache() {
        return dataCache;
    }

    public static boolean isRuntimeAvailable() {
        return jeiRuntime != null && ingredientRegistry != null && dataCache != null;
    }

    @Override
    public void register(@Nonnull IModRegistry registry) {
        ingredientRegistry = registry.getIngredientRegistry();
        LOG.info("JEI ingredient registry acquired");
    }

    @Override
    public void onRuntimeAvailable(@Nonnull IJeiRuntime runtime) {
        jeiRuntime = runtime;
        dataCache = new JeiDataCache(ingredientRegistry);
        LOG.info("JEI data cache built with {} items", dataCache.getTotalCount());

        try {
            httpServer = new JeiHttpBridgeServer();
            httpServer.start();
            LOG.info("JEI MCP Bridge HTTP server started on port {}", JeiHttpBridgeServer.PORT);
        } catch (Exception e) {
            LOG.error("Failed to start JEI MCP Bridge HTTP server", e);
        }
    }
}
