package com.jeimcp.bridge;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import net.minecraft.item.ItemStack;

import mezz.jei.api.ingredients.IIngredientHelper;
import mezz.jei.api.ingredients.IIngredientRegistry;
import mezz.jei.api.ingredients.VanillaTypes;

public class JeiDataCache {
    private final List<ItemStack> sortedItems;
    private final List<CacheEntry> sortedEntries;
    private final Map<String, CacheEntry> uidMap;
    private final IIngredientHelper<ItemStack> helper;

    public static class CacheEntry {
        private final ItemStack stack;
        private final String uid;
        private final String wildcardId;
        private final String displayName;
        private final String modId;
        private final String resourceId;

        CacheEntry(ItemStack stack, IIngredientHelper<ItemStack> helper) {
            this.stack = stack;
            this.uid = helper.getUniqueId(stack);
            this.wildcardId = helper.getWildcardId(stack);
            this.displayName = helper.getDisplayName(stack);
            this.modId = helper.getModId(stack);
            this.resourceId = helper.getResourceId(stack);
        }

        public ItemStack getStack() { return stack; }
        public String getUid() { return uid; }
        public String getWildcardId() { return wildcardId; }
        public String getDisplayName() { return displayName; }
        public String getModId() { return modId; }
        public String getResourceId() { return resourceId; }
    }

    public JeiDataCache(IIngredientRegistry registry) {
        this.helper = registry.getIngredientHelper(VanillaTypes.ITEM);
        Collection<ItemStack> allItems = registry.getAllIngredients(VanillaTypes.ITEM);

        List<CacheEntry> entries = new ArrayList<>();
        Map<String, CacheEntry> map = new HashMap<>();

        for (ItemStack stack : allItems) {
            if (stack.isEmpty()) continue;
            try {
                CacheEntry entry = new CacheEntry(stack, helper);
                entries.add(entry);
                map.put(entry.uid, entry);
            } catch (Exception ignored) {}
        }

        entries.sort((a, b) -> a.displayName.compareToIgnoreCase(b.displayName));

        this.sortedEntries = Collections.unmodifiableList(entries);
        this.sortedItems = Collections.unmodifiableList(
            entries.stream().map(e -> e.stack).collect(Collectors.toList())
        );
        this.uidMap = Collections.unmodifiableMap(map);
    }

    public IIngredientHelper<ItemStack> getHelper() {
        return helper;
    }

    public int getTotalCount() {
        return sortedEntries.size();
    }

    public List<ItemStack> getPage(int offset, int limit) {
        int to = Math.min(offset + limit, sortedItems.size());
        if (offset >= sortedItems.size()) return Collections.emptyList();
        return sortedItems.subList(offset, to);
    }

    public List<Map<String, Object>> getPageDetails(int offset, int limit) {
        int to = Math.min(offset + limit, sortedEntries.size());
        if (offset >= sortedEntries.size()) return Collections.emptyList();
        List<Map<String, Object>> results = new ArrayList<>();
        for (CacheEntry entry : sortedEntries.subList(offset, to)) {
            results.add(entryToMap(entry));
        }
        return results;
    }

    public ItemStack findByUid(String uid) {
        CacheEntry entry = uidMap.get(uid);
        if (entry != null) return entry.stack;
        for (CacheEntry e : sortedEntries) {
            if (e.wildcardId.equals(uid)) return e.stack;
            if (e.uid.equals(uid)) return e.stack;
        }
        return null;
    }

    public CacheEntry findEntryByUid(String uid) {
        CacheEntry entry = uidMap.get(uid);
        if (entry != null) return entry;
        for (CacheEntry e : sortedEntries) {
            if (e.wildcardId.equals(uid)) return e;
            if (e.uid.equals(uid)) return e;
        }
        return null;
    }

    public List<Map<String, Object>> search(String query, int offset, int limit) {
        String q = query.toLowerCase();
        List<Map<String, Object>> matched = new ArrayList<>();
        for (CacheEntry entry : sortedEntries) {
            if (entry.displayName.toLowerCase().contains(q)
                || entry.modId.contains(q)
                || entry.resourceId.contains(q)
                || entry.uid.contains(q)) {
                matched.add(entryToMap(entry));
            }
        }
        int to = Math.min(offset + limit, matched.size());
        if (offset >= matched.size()) return Collections.emptyList();
        return matched.subList(offset, to);
    }

    public int searchCount(String query) {
        String q = query.toLowerCase();
        int count = 0;
        for (CacheEntry entry : sortedEntries) {
            if (entry.displayName.toLowerCase().contains(q)
                || entry.modId.contains(q)
                || entry.resourceId.contains(q)
                || entry.uid.contains(q)) {
                count++;
            }
        }
        return count;
    }

    private static Map<String, Object> entryToMap(CacheEntry entry) {
        Map<String, Object> map = new HashMap<>();
        map.put("uid", entry.uid);
        map.put("wildcardId", entry.wildcardId);
        map.put("displayName", entry.displayName);
        map.put("modId", entry.modId);
        map.put("resourcePath", entry.resourceId);
        map.put("registryName", entry.stack.getItem().getRegistryName().toString());
        map.put("metadata", entry.stack.getMetadata());
        return map;
    }

    public static Map<String, Object> detailMap(CacheEntry entry, List<String> tooltip,
                                                  List<String> oreDict, List<String> creativeTabs) {
        Map<String, Object> map = entryToMap(entry);
        map.put("tooltip", tooltip);
        map.put("oreDict", oreDict);
        map.put("creativeTabs", creativeTabs);
        return map;
    }
}
