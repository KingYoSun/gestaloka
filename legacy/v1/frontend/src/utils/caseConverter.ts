/**
 * snake_caseとcamelCase間の変換ユーティリティ
 */

// 変換可能な値の型
type ConvertibleValue = unknown
type ConvertibleObject = { [key: string]: unknown }

/**
 * snake_caseをcamelCaseに変換
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * camelCaseをsnake_caseに変換
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

/**
 * オブジェクトのキーをsnake_caseからcamelCaseに変換
 */
export function snakeToCamelObject<T = ConvertibleObject>(
  obj: ConvertibleValue
): T {
  if (obj === null || obj === undefined) {
    return obj as T
  }

  if (Array.isArray(obj)) {
    return obj.map(item => snakeToCamelObject(item)) as T
  }

  if (typeof obj !== 'object' || obj instanceof Date) {
    return obj as T
  }

  const converted: Record<string, ConvertibleValue> = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = snakeToCamel(key)
      converted[camelKey] = snakeToCamelObject((obj as ConvertibleObject)[key])
    }
  }
  return converted as T
}

/**
 * オブジェクトのキーをcamelCaseからsnake_caseに変換
 */
export function camelToSnakeObject<T = ConvertibleObject>(
  obj: ConvertibleValue
): T {
  if (obj === null || obj === undefined) {
    return obj as T
  }

  if (Array.isArray(obj)) {
    return obj.map(item => camelToSnakeObject(item)) as T
  }

  if (typeof obj !== 'object' || obj instanceof Date) {
    return obj as T
  }

  const converted: Record<string, ConvertibleValue> = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const snakeKey = camelToSnake(key)
      converted[snakeKey] = camelToSnakeObject((obj as ConvertibleObject)[key])
    }
  }
  return converted as T
}
