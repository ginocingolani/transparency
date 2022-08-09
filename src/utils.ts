import { Tokens } from './entities/Tokens'
import { NetworkName } from './entities/Networks'
import BigNumber from 'bignumber.js'
import { createObjectCsvWriter } from 'csv-writer'
import { ObjectStringifierHeader } from 'csv-writer/src/lib/record'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import 'isomorphic-fetch'
import { Tags } from './entities/Tags'
import { TransactionParsed } from './export-transactions'
import { KPI } from './interfaces/KPIs'
import { MemberVP } from './interfaces/Members'
import { TransactionDetails } from './interfaces/Transactions/Transactions'
import { TransferType } from './interfaces/Transactions/Transfers'
import { CovalentResponse } from './interfaces/Covalent'

require('dotenv').config()

export const COVALENT_API_KEY = process.env.COVALENTHQ_API_KEY
export const INFURA_URL = process.env.INFURA_URL
export const DECENTRALAND_DATA_URL = process.env.DECENTRALAND_DATA_URL

export function sum(array: number[]) {
  return array.reduce((prev, curr) => prev + curr, 0)
}

export function avg(array: number[]) {
  return sum(array) / array.length
}

export function median(array: number[]) {
  if (array.length === 0) throw new Error("Median: no inputs")

  array.sort((a, b) => a - b)
  const half = Math.floor(array.length / 2)

  if (array.length % 2) {
    return array[half]
  }

  return (array[half - 1] + array[half]) / 2.0
}

export function parseNumber(n: number, decimals: number) {
  return new BigNumber(n).dividedBy(10 ** decimals).toNumber()
}

export function dayToMilisec(dayAmount: number) {
  return dayAmount * 24 * 60 * 60 * 1000
}

export function toISOString(seconds: number) {
  return seconds && new Date(seconds * 1000).toISOString()
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function fetchURL(url: string, options?: RequestInit, retry?: number): Promise<any> {
  retry = retry === undefined ? 3 : retry
  try {
    const res = await fetch(url, options)
    return await res.json()
  } catch (err) {
    if (retry <= 0) {
      console.error('Fetch Error')
      throw err
    }
    await delay(2000)
    return await fetchURL(url, options, retry - 1)
  }
}

export async function fetchCovalentURL<T>(url: string, pageSize = 10000) {
  let hasNext = true
  const result: T[] = []
  let page = 0
  let retries = 3

  while (hasNext) {
    const response: CovalentResponse<T> = await fetchURL(url + (pageSize === 0 ? '' : `&page-size=${pageSize}&page-number=${page}`))

    if(response.error) {
      if (retries > 0) {
        retries--
        console.log(`Retrying ${url}`)
        continue
      }
      throw Error(`Failed to fetch ${url} - message: ${response.error_message} - code: ${response.error_code}`)
    }

    result.push(...response.data.items)
    page++
    hasNext = response.data.pagination && response.data.pagination.has_more
  }

  return result
}

export async function fetchGraphQL<T>(url: string, collection: string, where: string, orderBy: string, fields: string, first?: number): Promise<T[]> {
  let hasNext = true
  first = first || 1000
  let skip = 0
  const query = `
  query get($first: Int!, $skip: Int!) {
    ${collection} (first: $first, skip: $skip, where: { ${where} }, orderBy: "${orderBy}", orderDirection: desc) {
      ${fields}
    }
  }
  `

  const elements: T[] = []
  while (hasNext) {
    const json = await fetchURL(url, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'query': query, 'variables': { first, skip } }),
      method: 'POST'
    }, 5)

    if (json.errors) {
      throw Error('GraphQL Fetch Error ' + JSON.stringify(json.errors))
    }

    const currentElements = (json?.data?.[collection] || []) as T[]
    elements.push(...currentElements)

    if (currentElements.length < first) {
      hasNext = false
    } else {
      skip = elements.length
    }
  }

  return elements
}

function removeDuplicates<T>(data: T[], dataKey: string) {
  const dataMap: Record<string, T> = {}
  for (const item of data) {
    dataMap[item[dataKey]] = item
  }

  return Object.values(dataMap)
}

export async function fetchGraphQLCondition<T>(url: string, collection: string, fieldNameCondition: string, dataKey: string, fields: string, first?: number): Promise<T[]> {
  let hasNext = true
  first = first || 1000
  let skip = 0
  let lastField = 0
  const query = `
    query get($first: Int!, $skip: Int!, $lastField: Int!) {
      ${collection} (first: $first, where: { ${fieldNameCondition}_gt: $lastField }, orderBy: "${fieldNameCondition}", orderDirection: asc) {
        ${fields}
      }
    }
  `

  const elements: T[] = []
  while (hasNext) {
    const json = await fetchURL(url, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'query': query, 'variables': { first, skip, lastField } }),
      method: 'POST'
    }, 5)

    if (json.errors) {
      throw Error('GraphQL Condition Fetch Error ' + JSON.stringify(json.errors))
    }

    const currentElements = (json?.data?.[collection] || []) as T[]
    elements.push(...currentElements)

    if (currentElements.length < first) {
      hasNext = false
    } else {
      skip = elements.length
      lastField = Number(elements[elements.length - 1][fieldNameCondition])
    }
  }

  return removeDuplicates(elements, dataKey)
}

export function saveToFile(name: string, data: string) {
  if (!existsSync('./public')) mkdirSync('./public')
  const path = './public/' + name
  writeFileSync(path, data, 'utf8')
}

export function saveToJSON(name: string, data: any) {
  saveToFile(name, JSON.stringify(data))
  console.log('The JSON file has been saved.')
}

export async function saveToCSV(name: string, data: any, header: ObjectStringifierHeader) {
  if (!existsSync('./public')) mkdirSync('./public')
  const path = './public/' + name
  const csvWriter = createObjectCsvWriter({ path, header })
  await csvWriter.writeRecords(data)
  console.log('The CSV file has been saved.')
}

export function flattenArray<Type>(arr: Type[][]): Type[] {
  return arr.reduce((acc, val) => acc.concat(val), [])
}

export function splitArray<Type>(array: Type[], chunkSize: number) {
  return Array(Math.ceil(array.length / chunkSize)).fill(null).map(function (_, i) {
    return array.slice(i * chunkSize, i * chunkSize + chunkSize)
  })
}

export function setTransactionTag(tx: TransactionParsed) {
  const interactedWith = tx.interactedWith.toLowerCase()
  let tag = Tags.get(interactedWith)

  if (tx.type === TransferType.IN) {
    tag = Tags.get(tx.from) || tag
  }
  else if (tx.type === TransferType.OUT) {
    tag = Tags.getCurator(tx.to) || Tags.get(tx.to) || tag
  }

  if (tag) {
    tx.tag = tag
  }
}

export function getTransactionsPerTag(transactions: TransactionParsed[]) {
  const group: Record<string, TransactionDetails> = {}

  for (const tx of transactions) {
    const result = group[tx.tag]
    if (result) {
      group[tx.tag] = {
        count: result.count + 1,
        total: result.total + tx.quote
      }
    }
    else {
      group[tx.tag] = {
        count: 1,
        total: tx.quote
      }
    }
  }

  return group
}

export function parseKPIs(kpis: KPI[]) {
  const result: any[] = []

  for (const kpi of kpis) {
    result.push(kpi.header)
    for (const row of kpi.rows) {
      result.push(row)
    }
    result.push([])
  }

  return result
}

export function parseVP(scores: number[]): MemberVP {

  if (scores.length !== 4 && scores.length !== 6) {
    throw Error('Invalid VP scores length')
  }

  const totalVP = scores.reduce((acc, val) => acc + val, 0)
  const manaVP = scores[0] + scores[3]
  const landVP = scores[1] + scores[2]

  if (scores.length === 4) {
    return {
      totalVP,
      manaVP,
      landVP,
      namesVP: 0,
      delegatedVP: 0
    }
  }

  return {
    totalVP,
    manaVP,
    landVP,
    namesVP: scores[4],
    delegatedVP: scores[5]
  }
}

export type LatestBlocks = Record<NetworkName, Record<string, number>>
export function getLatestBlockByToken(txs: TransactionParsed[]): LatestBlocks {
  const latestBlocks: LatestBlocks = {
    [NetworkName.ETHEREUM]: {},
    [NetworkName.POLYGON]: {}
  }

  for (const network of Object.values(NetworkName)) {
    for (const tokenAddress of Tokens.getAddresses(network)) {
      const latestBlock = txs.filter(tx => tx.network === network && tx.contract.toLowerCase() === tokenAddress).map(tx => tx.block).sort((a, b) => b - a)[0]
      if (latestBlock) {
        latestBlocks[network][tokenAddress] = latestBlock
      }
    }
  }

  return latestBlocks
}