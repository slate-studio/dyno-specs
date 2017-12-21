'use strict'

const _        = require('lodash')
const rootPath = process.cwd()

const DEFINITION_RE = /#\/definitions\/\w+/g

class Specs {
  constructor({ swagger, services, features, roles }, masterSpecPath = null) {
    this.features       = features
    this.roles          = roles
    this.swagger        = swagger
    this.services       = services
    this.masterSpecPath = masterSpecPath

    this._buildSpecsForRoles()
  }

  getSpec(roleId) {
    return this.specsByRole[roleId] || null
  }

  getOperationIds(roleId) {
    let operationIds   = []
    const spec         = this.getSpec(roleId)
    if (spec) {
      _.forEach(spec.paths, methods => {
        const chank = _.chain(methods)
          .map('operationId')
          .compact()
          .uniq()
          .value()
        operationIds = operationIds.concat(chank)
      })
    }
    return operationIds
  }

  getDependencyOperationIds(roleId) {
    let operationIds   = []
    const spec         = this.getSpec(roleId)

    if (spec) {
      _.forEach(spec.paths, methods => {
        _.forEach(methods, operation => {
          const dependencies = operation['x-dependency-operation-ids']
          if (dependencies) {
            _.forEach(dependencies, operationId => {
              const dependencyOperationId = `${operation.operationId}.${operationId}`
              operationIds.push(dependencyOperationId)
            })
          }
        })
      })
    }
    return operationIds
  }

  _buildSpecsForRoles() {
    this.specsByRole = {}

    this._bildMasterSpec()

    _.forEach(this.roles, (features, roleId) => {
      let operationIds = []
      _.forEach(features, featureId => {
        const feature = this.features[featureId]
        if (feature) {
          operationIds = operationIds.concat(feature.operationIds)
        }
      })

      const spec = _.cloneDeep(this.masterSpec)

      this._filterOperations(spec, operationIds)
      this._filterPaths(spec)
      this._filterDefinitions(spec)

      spec.tags       = this._buildTags(spec)
      spec.info.title = _.upperFirst(roleId)

      this.specsByRole[roleId] = spec
    })
  }

  _bildMasterSpec() {
    if (this.masterSpecPath !== null) {
      this.masterSpec = require(this.masterSpecPath)
      return
    }

    const spec = _.extend({}, this.swagger.spec)

    spec.tags        = []
    spec.paths       = {}
    spec.definitions = {}

    _.forEach(this.services, service => {
      const sspec    = _.cloneDeep(require(`${rootPath}/${service.spec}`))
      const basePath = sspec.basePath

      _.forEach(sspec.paths, (methods, path) => {
        const newPath       = `${basePath}${path}`
        spec.paths[newPath] = methods
      })

      _.merge(spec.definitions, sspec.definitions)
    })

    spec.tags = this._buildTags(spec)
    spec.info.version = this._mergeVersions()

    this.masterSpec = spec
  }

  _mergeVersions() {
    const numbers = _.map(this.services, service => {
      const spec = require(`${rootPath}/${service.spec}`)
      return spec.info.version.split('.').map(n => parseInt(n))
    })

    let v = _.zip(...numbers)
    v = _.map(v, numbers => _.sum(numbers))

    return v.join('.')
  }

  _filterOperations(spec, operationIds) {
    _.forEach(spec.paths, methods => {
      _.forEach(methods, (operation, method) => {
        const isNotFound = operationIds.indexOf(operation.operationId) == -1
        if (isNotFound) {
          delete methods[method]
        }
      })
    })
  }

  _filterPaths(spec) {
    _.forEach(spec.paths, (methods, path) => {
      if (_.isEmpty(methods)) {
        delete spec.paths[path]
      }
    })
  }

  _filterDefinitions(spec) {
    let pathsDefinitionKeys = []

    _.forEach(spec.paths, methods => {
      _.forEach(methods, operation => {
        const keys = this._parseDefinitionKeys(operation)
        pathsDefinitionKeys = _.concat(pathsDefinitionKeys, keys)
      })
    })

    let definitionKeys        = _.uniq(pathsDefinitionKeys)
    let definitionKeysToCheck = _.clone(definitionKeys)

    do {
      const embeddedDefinitionKeys =
        this._parseEmbeddedDefinitionKeys(spec.definitions, definitionKeysToCheck)

      definitionKeysToCheck = _.difference(embeddedDefinitionKeys, definitionKeys)

      definitionKeys = _.concat(definitionKeys, embeddedDefinitionKeys)
      definitionKeys = _.uniq(definitionKeys)

    } while (definitionKeysToCheck.length > 0)

    const allDefinitionKeys     = _.keys(spec.definitions)
    const privateDefinitionKeys = _.difference(allDefinitionKeys, definitionKeys)

    _.forEach(privateDefinitionKeys, key => {
      delete spec.definitions[key]
    })
  }

  _parseDefinitionKeys(object) {
    let keys = JSON.stringify(object).match(DEFINITION_RE)
    return _.map(keys, k => k.replace('#/definitions/', ''))
  }

  _parseEmbeddedDefinitionKeys(definitions, keys) {
    let result = []

    _.forEach(keys, key => {
      const definition = definitions[key]
      const keys = this._parseDefinitionKeys(definition)
      result = _.concat(result, keys)
    })

    return _.uniq(result)
  }

  _buildTags(spec) {
    let tags = []
    _.forEach(spec.paths, (methods) => {
      _.forEach(methods, (operation) => {
        tags = _.concat(tags, operation.tags)
      })
    })

    tags = _.uniq(tags)

    return _.map(tags, tag => { return { name: tag } })
  }
}

exports = module.exports = Specs

