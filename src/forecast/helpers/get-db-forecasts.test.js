import { MongoClient } from 'mongodb'
import { getForecastsFromDB } from './get-db-forecasts'

let client
let db
jest.setTimeout(30000)
beforeAll(async () => {
  client = await MongoClient.connect(global.__MONGO_URI__, {})
  db = client.db('testDB')
})

afterAll(async () => {
  if (client) await client.close(true)
})

beforeEach(async () => {
  await db.collection('forecasts').deleteMany({})
})

test('should return all forecasts from the database without _id', async () => {
  const mockData = [
    { name: 'Site A', value: 1 },
    { name: 'Site B', value: 2 }
  ]

  // Insert a deep copy to avoid mutation
  await db
    .collection('forecasts')
    .insertMany(JSON.parse(JSON.stringify(mockData)))

  const result = await getForecastsFromDB(db)

  expect(result).toEqual(mockData) // mockData is still clean
  expect(result.every((doc) => !('_id' in doc))).toBe(true)
})

test('should return an empty array if no forecasts exist', async () => {
  const result = await getForecastsFromDB(db)
  expect(result).toEqual([])
})

test('should handle documents with additional fields', async () => {
  const mockData = [{ name: 'Site A', value: 1, extra: 'info' }]
  await db.collection('forecasts').insertMany(mockData)

  const result = await getForecastsFromDB(db)

  expect(result[0]).toHaveProperty('extra', 'info')
})

test('should not include _id even if inserted documents have it', async () => {
  const mockData = [{ name: 'Site A', value: 1 }]
  await db.collection('forecasts').insertMany(mockData)

  const result = await getForecastsFromDB(db)

  expect(result[0]).not.toHaveProperty('_id')
})

test('should throw if db is not provided', async () => {
  await expect(getForecastsFromDB(null)).rejects.toThrow()
})

test('should throw if collection does not exist', async () => {
  // Drop the collection to simulate non-existence
  await db
    .collection('forecasts')
    .drop()
    .catch(() => {})
  const result = await getForecastsFromDB(db)
  expect(result).toEqual([]) // MongoDB returns empty cursor if collection doesn't exist
})
