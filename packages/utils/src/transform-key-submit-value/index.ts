import type { VueKey } from '@v-c/utils'
import { getArr as get, set as namePathSet } from '@v-c/utils'
import { isVNode } from 'vue'
import { isNil } from '../is-nil'
import { merge } from '../merge'
import type { SearchTransformKeyFn } from '../typing'

export type DataFormatMapType = Record<string, SearchTransformKeyFn | undefined>

/**
 * 暂时还不支持 Set和 Map 结构 判断是不是一个能遍历的对象
 *
 * @param itemValue
 * @returns Boolean
 */
export function isPlainObj(itemValue: any) {
  if (typeof itemValue !== 'object') return false

  /** Null 也要处理，不然omit空会失效 */
  if (itemValue === null) return true

  if (isVNode(itemValue)) return false
  if (itemValue.constructor === RegExp) return false
  if (itemValue instanceof Map) return false
  if (itemValue instanceof Set) return false
  if (itemValue instanceof HTMLElement) return false
  if (itemValue instanceof Blob) return false
  if (itemValue instanceof File) return false
  if (Array.isArray(itemValue)) return false
  return true
}

export const transformKeySubmitValue = <T extends object = any>(
  values: T,
  dataFormatMapRaw: Record<
    string,
    SearchTransformKeyFn | undefined | DataFormatMapType
  >,
  omit = true
) => {
  // ignore nil transform
  const dataFormatMap = Object.keys(dataFormatMapRaw).reduce((ret, key) => {
    const value = dataFormatMapRaw[key]
    if (!isNil(value)) {
      // eslint-disable-next-line no-param-reassign
      ret[key] = value! as SearchTransformKeyFn // can't be undefined
    }
    return ret
  }, {} as Record<string, SearchTransformKeyFn>)

  if (Object.keys(dataFormatMap).length < 1) {
    return values
  }

  if (typeof window === 'undefined') return values
  // 如果 value 是 string | null | Array | Blob类型 其中之一，直接返回
  // 形如 {key: [File, File]} 的表单字段当进行第二次递归时会导致其直接越过 typeof value !== 'object' 这一判断 https://github.com/ant-design/pro-components/issues/2071
  if (typeof values !== 'object' || isNil(values) || values instanceof Blob) {
    return values
  }
  let finalValues: any = Array.isArray(values) ? [] : ({} as T)

  const gen = (tempValues: T, parentsKey?: VueKey) => {
    const isArrayValues = Array.isArray(tempValues)
    let result = isArrayValues ? ([] as any) : ({} as T)
    if (tempValues === null || tempValues === undefined) {
      return result
    }

    Object.keys(tempValues).forEach((entityKey) => {
      const key = parentsKey
        ? [parentsKey, entityKey].flat(1)
        : [entityKey].flat(1)
      const itemValue = (tempValues as any)[entityKey]
      const transformFunction = get(dataFormatMap, key)

      const _transformArray = (transformFn: any, _itemValue: any) => {
        if (!Array.isArray(transformFn)) return entityKey
        transformFn.forEach((fn: any, idx: number) => {
          if (!fn) return
          if (typeof fn === 'function') {
            _itemValue[idx] = fn(_itemValue, entityKey, tempValues)
          }
          if (typeof fn === 'object' && !Array.isArray(fn)) {
            Object.keys(fn).forEach((curK) => {
              if (typeof fn[curK] === 'function') {
                const res = fn[curK](
                  _itemValue[idx][curK],
                  entityKey,
                  tempValues
                )
                _itemValue[idx][curK] =
                  typeof res === 'object' ? res[curK] : res
              } else if (
                typeof fn[curK] === 'object' &&
                Array.isArray(fn[curK]) &&
                _itemValue?.[idx]?.[curK]
              ) {
                _transformArray(fn[curK], _itemValue?.[idx]?.[curK])
              }
            })
          }
          if (
            typeof fn === 'object' &&
            Array.isArray(fn) &&
            _itemValue?.[idx]
          ) {
            _transformArray(fn, _itemValue?.[idx])
          }
        })
        return entityKey
      }

      const transform = () => {
        const tempKey =
          typeof transformFunction === 'function'
            ? transformFunction?.(itemValue, entityKey, tempValues)
            : _transformArray(transformFunction, itemValue)
        // { [key:string]:any } 数组也能通过编译
        if (Array.isArray(tempKey)) {
          result = namePathSet(result, tempKey, itemValue)
          return
        }
        if (typeof tempKey === 'object' && !Array.isArray(finalValues)) {
          finalValues = {
            ...finalValues,
            ...tempKey
          }
        } else if (typeof tempKey === 'object' && Array.isArray(finalValues)) {
          result = { ...result, ...tempKey }
        } else if (tempKey) {
          result = namePathSet(result, [tempKey], itemValue)
        }
      }

      /** 如果存在转化器提前渲染一下 */
      if (transformFunction && typeof transformFunction === 'function') {
        transform()
      }

      if (typeof window === 'undefined') return
      if (isPlainObj(itemValue)) {
        const genValues = gen(itemValue, key as any)
        if (Object.keys(genValues).length < 1) {
          return
        }
        result = namePathSet(result, [entityKey], genValues)
        return
      }
      transform()
    })
    // namePath、transform在omit为false时需正常返回 https://github.com/ant-design/pro-components/issues/2901#issue-908097115
    return omit ? result : tempValues
  }

  finalValues =
    Array.isArray(values) && Array.isArray(finalValues)
      ? [...gen(values)]
      : merge({}, gen(values), finalValues)

  return finalValues as T
}
