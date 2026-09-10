declare module 'semver' {
  export function satisfies(version: string, range: string, optionsOrLoose?: any): boolean
  export function gt(v1: string, v2: string, optionsOrLoose?: any): boolean
  export function lt(v1: string, v2: string, optionsOrLoose?: any): boolean
  export function valid(version: string, optionsOrLoose?: any): string | null
  const semver: {
    satisfies: typeof satisfies
    gt: typeof gt
    lt: typeof lt
    valid: typeof valid
  }
  export default semver
}
