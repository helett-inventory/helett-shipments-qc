-- Adds the Amazon SKU and FNSKU for Helett H30CLite BT (ASIN B0GYSTLWT3). Product name is kept.
insert into sku_map(asin, product_name, sku, fnsku) values
('B0GYSTLWT3', 'Helett H30CLite BT', 'Helett H30CLite BT Printer FBA', 'X002KRKFTZ')
on conflict (asin) do update set sku = excluded.sku, fnsku = excluded.fnsku;
