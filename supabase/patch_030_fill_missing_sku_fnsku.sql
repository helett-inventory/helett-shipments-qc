-- Fills the Amazon SKU and FNSKU for products that were missing them (from Seller Central). Product names are kept.
update sku_map m
set sku = v.sku, fnsku = v.fnsku
from (values
  ('B0DGF32QRT', 'Helett AC1200 Dual Band Wifi Router',      'X0024G8D23'),
  ('B0DTQ3ZCBH', 'HE24 Thermal Label Tape',                  'X00282L13V'),
  ('B0F8QKDJN3', 'Helett Ht15e Desktop Barcode Scanner FBA', 'X002B2LCH3'),
  ('B0CRB2KDC6', 'HT320 Digital Door MFN',                   'X001Z6GN1V'),
  ('B0BLV54ZQK', 'UY 14 UHF Wireless MIC',                   'X001O13W2F'),
  ('B0DBCW1PS4', 'UNIY UY720 Smartdoor Lock FBA',            'X0023AY7QV')
) as v(asin, sku, fnsku)
where m.asin = v.asin;
