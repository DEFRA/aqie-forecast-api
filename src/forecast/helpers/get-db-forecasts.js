async function getForecastsFromDB(db) {
  const cursor = db.collection('forecasts').find({}, { projection: { _id: 0 } })

  return await cursor.toArray()
}

export { getForecastsFromDB }
