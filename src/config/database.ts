import mongoose, { ConnectOptions } from 'mongoose'
import { env } from './keys.js'
import logger, { logError } from './logger.js'

interface DBConnect {
  isConnected: boolean
  retryCount: number
  maxRetries: number
}

const dbConnection: DBConnect = {
  isConnected: false,
  retryCount: 0,
  maxRetries: 5,
}

const connectionOptions: ConnectOptions = {
  dbName: env.DATABASE_NAME,
  serverSelectionTimeoutMS: 45000,
  socketTimeoutMS: 5000,
  retryReads: true,
  retryWrites: true,
  maxPoolSize: 50,
  minPoolSize: 1,
  monitorCommands: env.NODE_ENV === 'development',
}

export const connectDB = async (): Promise<void> => {
  if (dbConnection.isConnected) {
    logger.info('Using exisiting MongoDb connection')
    return
  }

  if (dbConnection.retryCount >= dbConnection.maxRetries) {
    logger.error('X Max MongoDb connection retries reached')
    process.exit(1)
  }

  try {
    const conn = await mongoose.connect(env.MONGO_URI, connectionOptions)
    dbConnection.isConnected = conn.connections[0].readyState === 1
    dbConnection.retryCount = 0 //reset retrycount upon successful connection

    if (dbConnection.isConnected) {
      logger.info(`MongoDb Connected: ${conn.connection.host}`)

      //conection event handlers
      mongoose.connection.on('error', err => {
        logger.error(`MongoDb connection error`, err)
        dbConnection.isConnected = false
      })

      mongoose.connection.on('disconnected', () => {
        logger.info('MongoDb disconnected')
        dbConnection.isConnected = false
        //attempt to reconnect
        if (dbConnection.retryCount < dbConnection.maxRetries) {
          dbConnection.retryCount++
          logger.info(`Attempting to reconnect (${dbConnection.retryCount}/${dbConnection.maxRetries})..`)
          setTimeout(connectDB, 5000)
        }
      })
    }
  } catch (error: unknown) {
    dbConnection.retryCount++
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logError(`MongoDb connection failed (attempt ${dbConnection.retryCount}/${dbConnection.maxRetries}):`, errorMessage)

    if (dbConnection.retryCount < dbConnection.maxRetries) {
      logger.info(`Retrying in 5 seconds...`)
      setTimeout(connectDB, 5000)
    } else {
      logger.error('Max retries reached. Exiting...')
      process.exit(1)
    }
  }
}

//handle graceful shutdown
export const gracefulShutDown = async (): Promise<void> => {
  try {
    logger.info(`Received shutdown signal. Closing server...`)
    //close mongodb connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close()
      logger.info(`MongoDb connection closed`)
    }
    logger.info(`Server shutdown complete`)
    process.exit(0)
  } catch (error) {
    logError(error, 'error during shutdown')
    process.exit(1)
  }
}

//handle uncaught exception
process.on('uncaughtException', (error: Error) => {
  logger.error(
    {
      err: { name: error.name },
      message: error.message,
    },
    `UNCAUGHT EXCEPTIONS! Shutting down`
  )
  gracefulShutDown().finally(() => process.exit(1))
})
