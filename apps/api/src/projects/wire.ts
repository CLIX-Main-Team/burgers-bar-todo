import type { Db } from '../db/client.js'
import { type ProjectRepository, createProjectRepository } from './repository.js'
import { type ProjectService, createProjectService } from './service.js'

// The projects composition root, mirroring task-board/wire.ts: build the data-access repository
// and the service against an injected db, and hand them back for the server and the integration
// harness to register through buildApp.
export interface ProjectComponents {
  repository: ProjectRepository
  service: ProjectService
}

export function createProjectComponents(db: Db): ProjectComponents {
  const repository = createProjectRepository(db)
  return { repository, service: createProjectService(repository) }
}
