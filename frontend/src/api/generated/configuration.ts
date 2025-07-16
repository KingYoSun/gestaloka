/**
 * Configuration class for API client
 * This is a temporary file that should be replaced by the generated one
 */
import type { AxiosRequestConfig } from 'axios'

export interface ConfigurationParameters {
  basePath?: string
  baseOptions?: AxiosRequestConfig
  accessToken?: string | (() => string)
}

export class Configuration {
  /**
   * base url
   */
  basePath?: string
  /**
   * base options for axios calls
   */
  baseOptions?: AxiosRequestConfig
  /**
   * The access token for OAuth2 security
   */
  accessToken?: string | (() => string)

  constructor(param: ConfigurationParameters = {}) {
    this.basePath = param.basePath
    this.baseOptions = param.baseOptions
    this.accessToken = param.accessToken
  }

  /**
   * Check if the given MIME is a JSON MIME.
   * JSON MIME examples:
   *   application/json
   *   application/json; charset=UTF8
   *   APPLICATION/JSON
   *   application/vnd.company+json
   * @param mime - MIME (Multipurpose Internet Mail Extensions)
   * @return True if the given MIME is JSON, false otherwise.
   */
  public isJsonMime(mime: string): boolean {
    const jsonMime: RegExp = new RegExp(
      '^(application\\/json|[^;/ \\t]+\\/[^;/ \\t]+[+]json)[ \\t]*(;.*)?$',
      'i'
    )
    return mime !== null && (jsonMime.test(mime) || mime.toLowerCase() === 'application/json-patch+json')
  }
}