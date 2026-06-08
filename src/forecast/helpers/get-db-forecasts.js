async function getForecastsFromDB(db) {
  const cursor = db.collection('forecasts').find({}, { projection: { _id: 0 } })

  return cursor.toArray()
}

export { getForecastsFromDB }
