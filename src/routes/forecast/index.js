import { findAllExampleData } from '../../example-find.js'

const forecast = [
  {
    method: 'GET',
    path: '/forecast',
    handler: async (request, h) => {
      const entities = await findAllExampleData(request.db)
      return h.response({ message: 'success', entities })
    }
  }
]

export { forecast }
