package com.jeimcp.bridge;

import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

@Mod(
    modid = JeiMcpBridgeMod.MOD_ID,
    name = JeiMcpBridgeMod.NAME,
    version = JeiMcpBridgeMod.VERSION,
    clientSideOnly = true,
    dependencies = "required-after:jei@[4.16.0,);"
)
public class JeiMcpBridgeMod {
    public static final String MOD_ID = "jei_mcp_bridge";
    public static final String NAME = "JEI MCP Bridge";
    public static final String VERSION = "1.0.0";

    private static final Logger LOG = LogManager.getLogger(MOD_ID);

    @Mod.EventHandler
    public void preInit(FMLPreInitializationEvent event) {
        BridgeConfig.resolve(event);
        LOG.info("JEI MCP Bridge initializing (port={})", BridgeConfig.get().getPort());
    }

    @Mod.EventHandler
    public void init(FMLInitializationEvent event) {
        LOG.info("JEI MCP Bridge initialized, waiting for JEI runtime...");
    }
}
