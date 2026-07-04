import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

const base = { SIGNAL_NUMBER: '+15551234567' }

describe('loadConfig', () => {
  it('loads defaults and derives the ws url from the api url', () => {
    const cfg = loadConfig({ ...base })
    expect(cfg.signalNumber).toBe('+15551234567')
    expect(cfg.port).toBe(8090)
    expect(cfg.signalApiUrl).toBe('http://signal-cli-rest-api:8080')
    expect(cfg.signalWsUrl).toBe('ws://signal-cli-rest-api:8080')
  })

  it('derives wss from https', () => {
    const cfg = loadConfig({ ...base, SIGNAL_API_URL: 'https://example.com:8443' })
    expect(cfg.signalWsUrl).toBe('wss://example.com:8443')
  })

  it('throws when SIGNAL_NUMBER is missing', () => {
    expect(() => loadConfig({})).toThrow(/SIGNAL_NUMBER is required/)
  })

  it('throws when SIGNAL_NUMBER is not E.164', () => {
    expect(() => loadConfig({ SIGNAL_NUMBER: '5551234567' })).toThrow(/E\.164/)
  })
})
