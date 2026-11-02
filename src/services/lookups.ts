import { cachedLookup } from '../lib/cache'
import { supabase } from '../lib/supabase'
import type { Profile, SkuRow } from '../types/db'

const TEN_MINUTES = 10 * 60 * 1000

// Products rarely change: one fetch serves every form for ten minutes.
export function getSkus(): Promise<SkuRow[]> {
  return cachedLookup(
    'sku_map',
    async () => {
      const { data, error } = await supabase
        .from('sku_map')
        .select('asin, product_name, sku, fnsku')
        .eq('active', true)
        .order('product_name')
      if (error) throw error
      return (data ?? []) as SkuRow[]
    },
    TEN_MINUTES
  )
}

// People with an account (for the name dropdowns).
export function getProfiles(): Promise<Profile[]> {
  return cachedLookup(
    'profiles',
    async () => {
      const { data, error } = await supabase.from('profiles').select('id, name, role, is_admin').order('name')
      if (error) throw error
      return (data ?? []) as Profile[]
    },
    TEN_MINUTES
  )
}
