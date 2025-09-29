async function getForecastSummaryFromDB(db) {
  // Fetch the latest summary document (type: 'latest') from the summary collection
  return await db
    .collection('forecast-summary')
    .findOne({ type: 'latest' }, { projection: { _id: 0 } })
}

export { getForecastSummaryFromDB }
