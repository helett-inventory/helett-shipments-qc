-- Everyone signed in can read the product list (ASIN, SKU, FNSKU); only Inventory can change it.
drop policy if exists sku_map_read on sku_map;
create policy sku_map_read on sku_map for select to authenticated using (true);
