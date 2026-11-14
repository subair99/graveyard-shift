import type { Greeting } from './b.ts'
import { greet } from './b.ts'

export function run(): Greeting {
  return greet('crypt')
}
