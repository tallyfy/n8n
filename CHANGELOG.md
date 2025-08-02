# Changelog

All notable changes to the n8n-nodes-tallyfy project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-08-02

### Added
- Initial release of the Tallyfy node for n8n
- Support for Blueprint (Process Template) operations:
  - Get, Get Many, Create, Update, Delete
- Support for Process (Run) operations:
  - Launch, Get, Get Many, Update, Delete
- Support for Task operations:
  - Complete, Get, Get Many, Create, Update
- Support for Comment operations:
  - Create, Update, Delete
- Support for User operations:
  - Get Current, Get, Get Many, Invite
- Support for Guest operations:
  - Create, Get, Get Many, Update, Delete
- Authentication via Personal Access Token
- Automatic inclusion of required X-Tallyfy-Client header
- Comprehensive error handling
- Pagination support for list operations
- Filtering and sorting capabilities
- Full TypeScript implementation
- MIT License