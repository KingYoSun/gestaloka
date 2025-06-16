/**
 * snake_caseとcamelCase間の変換ユーティリティ
 */

/**
 * snake_caseをcamelCaseに変換
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * camelCaseをsnake_caseに変換
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

/**
 * オブジェクトのキーをsnake_caseからcamelCaseに変換
 */
export function snakeToCamelObject<T = any>(obj: any): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(item => snakeToCamelObject(item)) as any
  }

  if (typeof obj !== 'object' || obj instanceof Date) {
    return obj
  }

  const converted: any = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = snakeToCamel(key)
      converted[camelKey] = snakeToCamelObject(obj[key])
    }
  }
  return converted
}

/**
 * オブジェクトのキーをcamelCaseからsnake_caseに変換
 */
export function camelToSnakeObject<T = any>(obj: any): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(item => camelToSnakeObject(item)) as any
  }

  if (typeof obj !== 'object' || obj instanceof Date) {
    return obj
  }

  const converted: any = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const snakeKey = camelToSnake(key)
      converted[snakeKey] = camelToSnakeObject(obj[key])
    }
  }
  return converted
}