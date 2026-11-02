-- SKU - ASIN - FNSKU map, from the Amazon Manage Inventory export.
-- Run after seed_sku_map.sql. Existing ASINs get sku + fnsku filled in (product_name is kept).
-- ASINs not in the seed are inserted with the Amazon SKU as the product name; rename them in Table Editor if you like.
-- FNSKUs are typed exactly as exported. Compare letter O and digit 0 against Seller Central if a scan ever mismatches.

insert into sku_map(asin, product_name, sku, fnsku) values
('B0FKZPDH66', 'Helett H30C Pro Printer', 'Helett H30C Pro Printer', 'X002DCWF8L'),
('B0DW8DX2M9', 'Helett H30CLite Printer', 'Helett H30CLite Printer', 'X0028CMAX1'),
('B0CJVGCB4K', 'helett H30C Thermal printer', 'helett H30C Thermal printer', 'X001VRM7PZ'),
('B0CZ99K438', 'helett H80i Autocut Thermal Printer', 'helett H80i Autocut Thermal Printer', 'X0020IWXP3'),
('B0CPDPTHVN', 'Helett HT20 Wireless Barcode Scanner FBA', 'Helett HT20 Wireless Barcode Scanner FBA', 'X001X1OZV3'),
('B0DPCRLRNJ', 'HT20pro Wirelss Barcode Scanner', 'HT20pro Wirelss Barcode Scanner', 'X0026PDL4R'),
('B0CBC9G7W2', 'HT410 wired Barcode scanner FBA', 'HT410 wired Barcode scanner FBA', 'X001X15XDH'),
('B0HLPJK6W3', 'HT-80i-Neo-RP-GY', 'HT-80i-Neo-RP-GY', 'X002PI35VT'),
('B0H5X3VCM5', 'Helett H58i BillQuick Go Reciept Printer', 'Helett H58i BillQuick Go Reciept Printer', 'X002MEXJG7'),
('B0GPCQ9KLN', 'helett HLT550 Portable Monitor', 'helett HLT550 Portable Monitor', 'X002IPTS9H'),
('B0HG4THQCH', 'Helett H80i Neo Receipt Printer FBA', 'Helett H80i Neo Receipt Printer FBA', 'X002O8JTP1'),
('B0HH3NH8G5', 'Helett Travel-Fi Neo', 'Helett Travel-Fi Neo', 'X002OG0Z1Z'),
('B0HCTXG4RD', 'helett HLT551 NEO Portable Monitor', 'helett HLT551 NEO Portable Monitor', 'X002NODXVR'),
('B0D9T8R3W8', 'Helett H01 Label Holder FBA', 'Helett H01 Label Holder FBA', 'X00234NC3L'),
('B0FZSCW83R', 'Helett H65C Label Printer Black', 'Helett H65C Label Printer Black', 'X002G5ZOO7'),
('B0FGCT1MWB', 'Helett Ht15 Desktop Barcode Scanner', 'Helett Ht15 Desktop Barcode Scanner', 'X002CH4R1Z'),
('B0GYSMFZC1', 'HT410 Lite wired Barcode scanner FBA', 'HT410 Lite wired Barcode scanner FBA', 'X002KS84C9'),
('B0DDL3TR1L', 'helett HE24 Label Printer FBA', 'helett HE24 Label Printer FBA', 'X0023TBPCB'),
('B0HJTWN5N7', 'HT-80i-MIN-RP', 'HT-80i-MIN-RP', 'X002OXUB53'),
('B0DW8PCP6D', 'Helett 4x6 Thermal Label', 'Helett 4x6 Thermal Label', 'X0028SCM4H'),
('B0C8JRN652', 'UY16 UHF Wireless mic', 'UY16 UHF Wireless mic', 'X001SXO769'),
('B0H1HP2K4L', 'Helett 4x6 Thermal Label (400) FBA', 'Helett 4x6 Thermal Label (400) FBA', 'X002LAZOF1'),
('B0C72FSCFM', 'U19 wireless Training Mic', 'U19 wireless Training Mic', 'X001WVU0BN'),
('B0F5Q4RV2R', 'Helett 2D Barcode Scanner Fba', 'Helett 2D Barcode Scanner Fba', 'X002ACAX4H'),
('B0H5R8L5LW', 'helett HLT552 Portable Monitor Pro', 'helett HLT552 Portable Monitor Pro', 'X002MD0IDF'),
('B0CXN44J7J', 'helett H58i Bluetooth Printer FBA', 'helett H58i Bluetooth Printer FBA', 'X001ZD3EP7'),
('B0H6QGN526', '2x1 Label Roll Pack of 4', '2x1 Label Roll Pack of 4', 'X002MMIMRF'),
('B0GSZRF4M5', 'Helett Z567 Tyre Inflator NEW', 'Helett Z567 Tyre Inflator NEW', 'X002JG8CK1'),
('B0DTNVQ34H', 'HE24 Label Tape', 'HE24 Label Tape', 'X00282BS9X'),
('B0DXKWKBWQ', 'Helett 2x1.5 Thermal Label', 'Helett 2x1.5 Thermal Label', 'X0028SCJVD'),
('B0FL2VFCT9', 'HE24 Thermal Label 12x50', 'HE24 Thermal Label 12x50', 'X002DDYAC9'),
('B0CBXG8CLB', 'helett HT1400 smart door lock', 'helett HT1400 smart door lock', 'X001TIP4ZB'),
('B0GDKY6QHN', 'Helett infiStick android stick', 'Helett infiStick android stick', 'X002HDJ79L')
on conflict (asin) do update set sku = excluded.sku, fnsku = excluded.fnsku;

-- Products still without an FNSKU (not in the export). Add them when you have the data:
--   select asin, product_name from sku_map where fnsku is null or fnsku = '' order by product_name;
