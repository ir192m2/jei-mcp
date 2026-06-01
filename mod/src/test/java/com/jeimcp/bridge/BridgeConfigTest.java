package com.jeimcp.bridge;

import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

import static org.junit.Assert.*;

public class BridgeConfigTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    private String savedSysProp;

    @Before
    public void clearConfigState() {
        savedSysProp = System.getProperty(BridgeConfig.SYS_PROP);
        System.clearProperty(BridgeConfig.SYS_PROP);
    }

    @After
    public void restoreConfigState() {
        if (savedSysProp != null) {
            System.setProperty(BridgeConfig.SYS_PROP, savedSysProp);
        } else {
            System.clearProperty(BridgeConfig.SYS_PROP);
        }
    }

    @Test
    public void validate_acceptsValidPort() {
        assertEquals(8080, BridgeConfig.validate(8080));
        assertEquals(1024, BridgeConfig.validate(1024));
        assertEquals(65535, BridgeConfig.validate(65535));
        assertEquals(18732, BridgeConfig.validate(18732));
    }

    @Test
    public void validate_rejectsOutOfRange() {
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(1023));
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(0));
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(65536));
        assertEquals(BridgeConfig.DEFAULT_PORT, BridgeConfig.validate(-100));
    }

    @Test
    public void readFromConfigFile_returnsMinusOneWhenMissing() {
        assertEquals(-1, BridgeConfig.readFromConfigFile(new File("/nonexistent/path")));
    }

    @Test
    public void readFromConfigFile_parsesValidPort() throws IOException {
        File configDir = tempFolder.newFolder("jeimcp");
        try (FileWriter w = new FileWriter(new File(configDir, "bridge.properties"))) {
            w.write("port=28732\n");
        }
        assertEquals(28732, BridgeConfig.readFromConfigFile(configDir));
    }

    @Test
    public void readFromConfigFile_handlesWhitespace() throws IOException {
        File configDir = tempFolder.newFolder("jeimcp");
        try (FileWriter w = new FileWriter(new File(configDir, "bridge.properties"))) {
            w.write("  port = 28999  \n");
        }
        assertEquals(28999, BridgeConfig.readFromConfigFile(configDir));
    }

    @Test
    public void readFromConfigFile_returnsMinusOneOnInvalidNumber() throws IOException {
        File configDir = tempFolder.newFolder("jeimcp");
        try (FileWriter w = new FileWriter(new File(configDir, "bridge.properties"))) {
            w.write("port=not_a_number\n");
        }
        assertEquals(-1, BridgeConfig.readFromConfigFile(configDir));
    }

    @Test
    public void readFromSystemProperty_parsesValidValue() {
        System.setProperty(BridgeConfig.SYS_PROP, "28888");
        assertEquals(28888, BridgeConfig.readFromSystemProperty(BridgeConfig.SYS_PROP));
    }

    @Test
    public void readFromSystemProperty_returnsMinusOneWhenUnset() {
        assertEquals(-1, BridgeConfig.readFromSystemProperty(BridgeConfig.SYS_PROP));
    }

    @Test
    public void resolvePort_defaultWhenNothingSet() {
        BridgeConfig.Resolution r = BridgeConfig.resolvePort(
            new File("/nonexistent"), "nonexistent.sysprop", "NONEXISTENT_ENVVAR");
        assertEquals(BridgeConfig.DEFAULT_PORT, r.port);
        assertEquals("default", r.source);
    }

    @Test
    public void resolvePort_configFileWinsOverSysProp() throws IOException {
        File configDir = tempFolder.newFolder("jeimcp");
        try (FileWriter w = new FileWriter(new File(configDir, "bridge.properties"))) {
            w.write("port=20000\n");
        }
        System.setProperty("test.jei", "20001");
        BridgeConfig.Resolution r = BridgeConfig.resolvePort(configDir, "test.jei", "TEST_JEI_ENVVAR");
        assertEquals(20000, r.port);
        assertEquals("config file", r.source);
    }
}
