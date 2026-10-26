import type { BuildingStyle } from '../../types'
import { build as office } from './office'
import { build as factory } from './factory'
import { build as cafe } from './cafe'
import { build as bookstore } from './bookstore'
import { build as lab } from './lab'
import { build as warehouse } from './warehouse'
import { build as radioTower } from './radioTower'
import { build as greenhouse } from './greenhouse'
import { build as clockTower } from './clockTower'
import { build as ramenShop } from './ramenShop'
import type { BuildFn } from './types'

export const BUILDERS: Record<BuildingStyle, BuildFn> = {
  office, factory, cafe, bookstore, lab, warehouse, radioTower, greenhouse, clockTower, ramenShop,
}
