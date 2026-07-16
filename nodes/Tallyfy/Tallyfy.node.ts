import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';

import { NodeConnectionType } from 'n8n-workflow';

export class Tallyfy implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Tallyfy',
		name: 'tallyfy',
		icon: 'file:tallyfy.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Tallyfy workflow automation platform',
		defaults: {
			name: 'Tallyfy',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'tallyfyApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Blueprint',
						value: 'blueprint',
						description: 'Process templates',
					},
					{
						name: 'Process',
						value: 'process',
						description: 'Process instances (runs)',
					},
					{
						name: 'Task',
						value: 'task',
						description: 'Individual tasks',
					},
					{
						name: 'Form Field',
						value: 'formField',
						description: 'Form fields in tasks',
					},
					{
						name: 'Comment',
						value: 'comment',
						description: 'Comments on tasks or processes',
					},
					{
						name: 'User',
						value: 'user',
						description: 'User management',
					},
					{
						name: 'Guest',
						value: 'guest',
						description: 'Guest management',
					},
					{
						name: 'Group',
						value: 'group',
						description: 'Group management',
					},
					{
						name: 'Tag',
						value: 'tag',
						description: 'Tag management',
					},
					{
						name: 'Folder',
						value: 'folder',
						description: 'Folder management',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search across Tallyfy',
					},
					{
						name: 'ID Finder',
						value: 'idFinder',
						description: 'Find IDs for various resources',
					},
				],
				default: 'task',
				required: true,
			},

			// ===== BLUEPRINT OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get a blueprint',
						action: 'Get a blueprint',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many blueprints',
						action: 'Get many blueprints',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a blueprint',
						action: 'Create a blueprint',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a blueprint',
						action: 'Update a blueprint',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a blueprint',
						action: 'Delete a blueprint',
					},
					{
						name: 'Clone',
						value: 'clone',
						description: 'Clone a blueprint (template)',
						action: 'Clone a blueprint',
					},
					{
						name: 'Get Kickoff Fields',
						value: 'getKickoffFields',
						description: 'Get a template kickoff (prerun) fields',
						action: 'Get kickoff fields',
					},
					{
						name: 'List Steps',
						value: 'listSteps',
						description: 'List all steps of a template',
						action: 'List template steps',
					},
				],
				default: 'getAll',
			},

			// ===== PROCESS OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['process'],
					},
				},
				options: [
					{
						name: 'Launch',
						value: 'launch',
						description: 'Launch a new process from a blueprint',
						action: 'Launch a process',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a process',
						action: 'Get a process',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many processes',
						action: 'Get many processes',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a process',
						action: 'Update a process',
					},
					{
						name: 'Archive',
						value: 'archive',
						description: 'Archive a process (soft delete)',
						action: 'Archive a process',
					},
					{
						name: 'Get Tasks',
						value: 'getTasks',
						description: 'Get all tasks in a process',
						action: 'Get process tasks',
					},
					{
						name: 'Reactivate',
						value: 'reactivate',
						description: 'Reactivate an archived process',
						action: 'Reactivate a process',
					},
					{
						name: 'Complete Kickoff Form',
						value: 'completeKickoffForm',
						description: 'Mark a process kickoff form as submitted',
						action: 'Complete kickoff form',
					},
					{
						name: 'Reopen Kickoff Form',
						value: 'reopenKickoffForm',
						description: 'Reopen a submitted kickoff form for edits',
						action: 'Reopen kickoff form',
					},
				],
				default: 'launch',
			},

			// ===== TASK OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['task'],
					},
				},
				options: [
					{
						name: 'Create One-Off',
						value: 'createOneOff',
						description: 'Create a standalone task with all properties',
						action: 'Create one-off task',
					},
					{
						name: 'Complete',
						value: 'complete',
						description: 'Complete a task',
						action: 'Complete a task',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a task',
						action: 'Get a task',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many tasks',
						action: 'Get many tasks',
					},
					{
						name: 'Update Properties',
						value: 'updateProperties',
						description: 'Update task properties (title, deadline, assignees, etc.)',
						action: 'Update task properties',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a task',
						action: 'Delete a task',
					},
					{
						name: 'Clone',
						value: 'clone',
						description: 'Clone a task',
						action: 'Clone a task',
					},
					{
						name: 'Get My Tasks',
						value: 'getMyTasks',
						description: 'List tasks assigned to the connected user',
						action: 'Get my tasks',
					},
					{
						name: 'Get User Tasks',
						value: 'getUserTasks',
						description: 'List tasks assigned to a specific member',
						action: 'Get user tasks',
					},
					{
						name: 'Get Guest Tasks',
						value: 'getGuestTasks',
						description: 'List tasks assigned to a guest',
						action: 'Get guest tasks',
					},
					{
						name: 'Reopen',
						value: 'reopen',
						description: 'Reopen a completed task',
						action: 'Reopen a task',
					},
					{
						name: 'Get Process Task',
						value: 'getProcessTask',
						description: 'Get one task inside a process',
						action: 'Get process task',
					},
					{
						name: 'Update Process Task',
						value: 'updateProcessTask',
						description: 'Update a task inside a process (title, deadline, owners, form values, status)',
						action: 'Update process task',
					},
				],
				default: 'complete',
			},

			// ===== FORM FIELD OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['formField'],
					},
				},
				options: [
					{
						name: 'Update Value',
						value: 'updateValue',
						description: 'Update a form field value in a task',
						action: 'Update form field value',
					},
					{
						name: 'Get Fields',
						value: 'getFields',
						description: 'Get all form fields for a task or process',
						action: 'Get form fields',
					},
					{
						name: 'Add Field',
						value: 'addField',
						description: 'Add a form field to a template step',
						action: 'Add form field',
					},
					{
						name: 'Update Field',
						value: 'updateField',
						description: 'Update a form field on a template step',
						action: 'Update form field',
					},
					{
						name: 'Move Field',
						value: 'moveField',
						description: 'Move a form field to another step',
						action: 'Move form field',
					},
					{
						name: 'Delete Field',
						value: 'deleteField',
						description: 'Delete a form field from a template step',
						action: 'Delete form field',
					},
					{
						name: 'Get Dropdown Options',
						value: 'getDropdownOptions',
						description: 'Get the options of a choice field',
						action: 'Get dropdown options',
					},
					{
						name: 'Update Dropdown Options',
						value: 'updateDropdownOptions',
						description: 'Replace the options of a choice field',
						action: 'Update dropdown options',
					},
					{
						name: 'Add Kickoff Field',
						value: 'addKickoffField',
						description: 'Add a field to the template kickoff form',
						action: 'Add kickoff field',
					},
					{
						name: 'Update Kickoff Field',
						value: 'updateKickoffField',
						description: 'Update a kickoff field',
						action: 'Update kickoff field',
					},
					{
						name: 'Delete Kickoff Field',
						value: 'deleteKickoffField',
						description: 'Delete a kickoff field',
						action: 'Delete kickoff field',
					},
					{
						name: 'Reorder Kickoff Fields',
						value: 'reorderKickoffField',
						description: 'Reorder the template kickoff fields',
						action: 'Reorder kickoff fields',
					},
				],
				default: 'updateValue',
			},

			// ===== COMMENT OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['comment'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Add a comment to a task',
						action: 'Create a comment',
					},
					{
						name: 'Create Bot Comment',
						value: 'createBot',
						description: 'Add a bot comment (no notifications)',
						action: 'Create bot comment',
					},
					{
						name: 'Report Problem',
						value: 'reportProblem',
						description: 'Report a problem/blocker on a task',
						action: 'Report problem',
					},
					{
						name: 'Resolve Issue',
						value: 'resolveIssue',
						description: 'Mark an issue as resolved',
						action: 'Resolve issue',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a comment',
						action: 'Update a comment',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a comment',
						action: 'Delete a comment',
					},
					{
						name: 'List',
						value: 'list',
						description: 'List all comments and issues on a process task',
						action: 'List task comments',
					},
				],
				default: 'create',
			},

			// ===== USER OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['user'],
					},
				},
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get a user',
						action: 'Get a user',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many users',
						action: 'Get many users',
					},
					{
						name: 'Get Current',
						value: 'getCurrent',
						description: 'Get current authenticated user',
						action: 'Get current user',
					},
					{
						name: 'Invite',
						value: 'invite',
						description: 'Invite a user to organization',
						action: 'Invite a user',
					},
					{
						name: 'Update Role',
						value: 'updateRole',
						description: 'Update user role',
						action: 'Update user role',
					},
					{
						name: 'Disable',
						value: 'disable',
						description: 'Disable a user',
						action: 'Disable user',
					},
					{
						name: 'Enable',
						value: 'enable',
						description: 'Enable a user',
						action: 'Enable user',
					},
					{
						name: 'Convert to Guest',
						value: 'convertToGuest',
						description: 'Convert member to guest',
						action: 'Convert to guest',
					},
					{
						name: 'Get Organization',
						value: 'getOrganization',
						description: 'Get the organization details',
						action: 'Get organization',
					},
				],
				default: 'getAll',
			},

			// ===== GUEST OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['guest'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a guest',
						action: 'Create a guest',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a guest',
						action: 'Get a guest',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many guests',
						action: 'Get many guests',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update guest information',
						action: 'Update a guest',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a guest',
						action: 'Delete a guest',
					},
					{
						name: 'Convert to Member',
						value: 'convertToMember',
						description: 'Convert guest to member',
						action: 'Convert to member',
					},
					{
						name: 'Enable',
						value: 'enable',
						description: 'Re-enable a disabled guest',
						action: 'Enable a guest',
					},
					{
						name: 'Disable',
						value: 'disable',
						description: 'Disable a guest (blocks org access)',
						action: 'Disable a guest',
					},
				],
				default: 'create',
			},

			// ===== GROUP OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['group'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a group',
						action: 'Create a group',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a group',
						action: 'Get a group',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Get many groups',
						action: 'Get many groups',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update group (including members)',
						action: 'Update a group',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a group',
						action: 'Delete a group',
					},
				],
				default: 'create',
			},

			// ===== SEARCH OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['search'],
					},
				},
				options: [
					{
						name: 'Global Search',
						value: 'global',
						description: 'Search across all Tallyfy resources',
						action: 'Global search',
					},
					{
						name: 'Search Tasks',
						value: 'tasks',
						description: 'Search for tasks',
						action: 'Search tasks',
					},
					{
						name: 'Search Processes',
						value: 'processes',
						description: 'Search for processes',
						action: 'Search processes',
					},
					{
						name: 'Search Blueprints',
						value: 'blueprints',
						description: 'Search for blueprints',
						action: 'Search blueprints',
					},
					{
						name: 'Search Snippets',
						value: 'snippets',
						description: 'Search for text snippets',
						action: 'Search snippets',
					},
				],
				default: 'global',
			},

			// ===== ID FINDER OPERATIONS =====
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['idFinder'],
					},
				},
				options: [
					{
						name: 'Find Process ID',
						value: 'findProcessId',
						description: 'Find process ID by name or search',
						action: 'Find process ID',
					},
					{
						name: 'Find Task ID',
						value: 'findTaskId',
						description: 'Find task ID by name or search',
						action: 'Find task ID',
					},
					{
						name: 'Find Blueprint ID',
						value: 'findBlueprintId',
						description: 'Find blueprint ID by name or search',
						action: 'Find blueprint ID',
					},
					{
						name: 'Find Form Field ID',
						value: 'findFormFieldId',
						description: 'Find form field ID in a task or process',
						action: 'Find form field ID',
					},
					{
						name: 'Find User ID',
						value: 'findUserId',
						description: 'Find user ID by email or name',
						action: 'Find user ID',
					},
					{
						name: 'Find Group ID',
						value: 'findGroupId',
						description: 'Find group ID by name',
						action: 'Find group ID',
					},
				],
				default: 'findProcessId',
			},

			// ================================
			// FIELD DEFINITIONS FOR EACH RESOURCE
			// ================================

			// ===== BLUEPRINT FIELDS =====
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['get', 'update', 'delete', 'clone', 'getKickoffFields', 'listSteps'],
					},
				},
				description: 'The ID of the blueprint',
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['create', 'update'],
					},
				},
				description: 'The title of the blueprint (max 250 characters)',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				options: [
					{
						name: 'Procedure',
						value: 'procedure',
					},
					{
						name: 'Form',
						value: 'form',
					},
					{
						name: 'Document',
						value: 'document',
					},
				],
				default: 'procedure',
				required: true,
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['create'],
					},
				},
				description: 'The type of blueprint',
			},

			// ===== PROCESS FIELDS =====
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['get', 'update', 'archive', 'getTasks', 'reactivate', 'completeKickoffForm', 'reopenKickoffForm'],
					},
				},
				description: 'The ID of the process',
			},
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['launch'],
					},
				},
				description: 'The ID of the blueprint to launch',
			},
			{
				displayName: 'Process Name',
				name: 'processName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['launch'],
					},
				},
				description: 'Name for the new process instance',
			},

			// ===== TASK FIELDS =====
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['complete', 'get', 'updateProperties', 'delete', 'clone', 'reopen', 'getProcessTask', 'updateProcessTask'],
					},
				},
				description: 'The ID of the task',
			},

			// One-off task creation fields
			{
				displayName: 'Task Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff'],
					},
				},
				description: 'Title of the task (max 600 characters)',
			},
			{
				displayName: 'Task Type',
				name: 'task_type',
				type: 'options',
				options: [
					{
						name: 'Task',
						value: 'task',
					},
					{
						name: 'Approval',
						value: 'approval',
					},
					{
						name: 'Expiring',
						value: 'expiring',
					},
					{
						name: 'Email',
						value: 'email',
					},
				],
				default: 'task',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff'],
					},
				},
				description: 'The type of task',
			},
			{
				displayName: 'Deadline',
				name: 'deadline',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff'],
					},
				},
				description: 'The deadline for the task',
			},

			// Required fields for task update
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProperties'],
					},
				},
				description: 'Title of the task (required for update)',
			},
			{
				displayName: 'Deadline',
				name: 'deadline',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProperties'],
					},
				},
				description: 'Deadline for the task (required for update)',
			},
			// Task property update fields
			{
				displayName: 'Properties to Update',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Property',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProperties'],
					},
				},
				options: [
					{
						displayName: 'Task Type',
						name: 'task_type',
						type: 'options',
						options: [
							{
								name: 'Task',
								value: 'task',
							},
							{
								name: 'Approval',
								value: 'approval',
							},
							{
								name: 'Expiring',
								value: 'expiring',
							},
							{
								name: 'Email',
								value: 'email',
							},
						],
						default: 'task',
						description: 'Change the task type',
					},
					{
						displayName: 'Assign Users',
						name: 'assignUsers',
						type: 'string',
						default: '',
						description: 'Comma-separated list of user IDs to assign',
					},
					{
						displayName: 'Assign Guests',
						name: 'assignGuests',
						type: 'string',
						default: '',
						description: 'Comma-separated list of guest emails to assign',
					},
					{
						displayName: 'Assign Groups',
						name: 'assignGroups',
						type: 'string',
						default: '',
						description: 'Comma-separated list of group IDs to assign',
					},
					{
						displayName: 'Max Assignable',
						name: 'max_assignable',
						type: 'number',
						default: 0,
						description: 'Maximum number of assignees allowed',
					},
					{
						displayName: 'Prevent Guest Comment',
						name: 'prevent_guest_comment',
						type: 'boolean',
						default: false,
						description: 'Prevent guests from commenting',
					},
					{
						displayName: 'Top Secret',
						name: 'top_secret',
						type: 'boolean',
						default: false,
						description: 'Mark task as top secret',
					},
				],
			},

			// Task one-off additional fields
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['createOneOff', 'complete'],
					},
				},
				options: [
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
						description: 'Task summary',
					},
					{
						displayName: 'Assign Users',
						name: 'assignUsers',
						type: 'string',
						default: '',
						description: 'Comma-separated list of user IDs to assign',
					},
					{
						displayName: 'Assign Guests',
						name: 'assignGuests',
						type: 'string',
						default: '',
						description: 'Comma-separated list of guest emails to assign',
					},
					{
						displayName: 'Assign Groups',
						name: 'assignGroups',
						type: 'string',
						default: '',
						description: 'Comma-separated list of group IDs to assign',
					},
					{
						displayName: 'Start Date',
						name: 'started_at',
						type: 'dateTime',
						default: '',
						description: 'When the task should start',
					},
					{
						displayName: 'Everyone Must Complete',
						name: 'everyone_must_complete',
						type: 'boolean',
						default: false,
						description: 'All assignees must complete the task',
					},
					{
						displayName: 'Comment',
						name: 'comment',
						type: 'string',
						typeOptions: {
							rows: 4,
						},
						default: '',
						description: 'Comment to add when completing the task',
					},
					{
						displayName: 'Webhook URL',
						name: 'webhook',
						type: 'string',
						default: '',
						description: 'Webhook to call on task events',
					},
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description: 'Comma-separated list of tag IDs',
					},
				],
			},

			// ===== FORM FIELD FIELDS =====
			{
				displayName: 'Context Type',
				name: 'contextType',
				type: 'options',
				options: [
					{
						name: 'Process',
						value: 'process',
					},
					{
						name: 'Blueprint',
						value: 'blueprint',
					},
				],
				default: 'process',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['getFields'],
					},
				},
				description: 'Whether to get fields from a process or blueprint',
			},
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['getFields'],
						contextType: ['process'],
					},
				},
				description: 'The ID of the process',
			},
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['getFields'],
						contextType: ['blueprint'],
					},
				},
				description: 'The ID of the blueprint',
			},
			{
				displayName: 'Form Field ID',
				name: 'formFieldId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
					},
				},
				description: 'The ID of the form field (CaptureValue ID)',
			},
			{
				displayName: 'Field Value',
				name: 'fieldValue',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
					},
				},
				description: 'The value to set for the form field',
			},
			{
				displayName: 'As Guest',
				name: 'asGuest',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
					},
				},
				description: 'Update as a guest (requires guest email)',
			},
			{
				displayName: 'Guest Email',
				name: 'guestEmail',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateValue'],
						asGuest: [true],
					},
				},
				description: 'Guest email for updating the field',
			},

			// ===== COMMENT FIELDS =====
			{
				displayName: 'Task ID',
				name: 'taskId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['create', 'createBot', 'reportProblem', 'resolveIssue', 'update', 'delete', 'list'],
					},
				},
				description: 'The ID of the task to comment on',
			},
			{
				displayName: 'Comment ID',
				name: 'commentId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['update', 'delete'],
					},
				},
				description: 'The ID of the comment',
			},
			{
				displayName: 'Comment Content',
				name: 'content',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['create', 'createBot', 'reportProblem', 'resolveIssue', 'update'],
					},
				},
				description: 'The comment content (supports HTML)',
			},
			{
				displayName: 'Thread ID',
				name: 'threadId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['resolveIssue'],
					},
				},
				description: 'The ID of the issue thread to resolve',
			},

			// ===== USER FIELDS =====
			{
				displayName: 'User ID',
				name: 'userId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['get', 'updateRole', 'disable', 'enable', 'convertToGuest'],
					},
				},
				description: 'The ID of the user',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'user@example.com',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'Email address of the user to invite',
			},
			{
				displayName: 'First Name',
				name: 'firstName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'First name of the user (max 32 characters)',
			},
			{
				displayName: 'Last Name',
				name: 'lastName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'Last name of the user (max 32 characters)',
			},
			{
				displayName: 'Role',
				name: 'role',
				type: 'options',
				options: [
					{
						name: 'Admin',
						value: 'admin',
					},
					{
						name: 'Standard',
						value: 'standard',
					},
					{
						name: 'Light',
						value: 'light',
					},
				],
				default: 'standard',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite', 'updateRole'],
					},
				},
				description: 'Role for the user',
			},
			{
				displayName: 'Invitation Message',
				name: 'message',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: 'You have been invited to join our Tallyfy organization.',
				required: true,
				displayOptions: {
					show: {
						resource: ['user'],
						operation: ['invite'],
					},
				},
				description: 'Message to include in the invitation (max 5000 characters)',
			},

			// ===== GUEST FIELDS =====
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'guest@example.com',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['guest'],
						operation: ['create', 'get', 'update', 'delete', 'convertToMember', 'enable', 'disable'],
					},
				},
				description: 'Email address of the guest',
			},
			{
				displayName: 'First Name',
				name: 'firstName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['guest'],
						operation: ['create', 'update'],
					},
				},
				description: 'First name of the guest',
			},
			{
				displayName: 'Last Name',
				name: 'lastName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['guest'],
						operation: ['create', 'update'],
					},
				},
				description: 'Last name of the guest',
			},

			// ===== GROUP FIELDS =====
			{
				displayName: 'Group Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create'],
					},
				},
				description: 'Name of the group (must be unique)',
			},
			{
				displayName: 'Group ID',
				name: 'groupId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['get', 'update', 'delete'],
					},
				},
				description: 'The ID of the group',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create', 'update'],
					},
				},
				description: 'Description of the group',
			},
			{
				displayName: 'Members',
				name: 'members',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create', 'update'],
					},
				},
				description: 'Comma-separated list of user IDs to add to the group',
			},
			{
				displayName: 'Guests',
				name: 'guests',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['group'],
						operation: ['create', 'update'],
					},
				},
				description: 'Comma-separated list of guest emails to add to the group',
			},

			// ===== SEARCH FIELDS =====
			{
				displayName: 'Search Query',
				name: 'searchQuery',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['search'],
					},
				},
				description: 'The search query',
			},
			{
				displayName: 'Search In',
				name: 'searchIn',
				type: 'multiOptions',
				options: [
					{
						name: 'Blueprints',
						value: 'blueprint',
					},
					{
						name: 'Processes',
						value: 'process',
					},
					{
						name: 'Tasks',
						value: 'task',
					},
					{
						name: 'Steps',
						value: 'step',
					},
					{
						name: 'Form Fields',
						value: 'capture',
					},
					{
						name: 'Snippets',
						value: 'snippet',
					},
				],
				default: ['blueprint', 'process', 'task'],
				displayOptions: {
					show: {
						resource: ['search'],
						operation: ['global'],
					},
				},
				description: 'What types of resources to search',
			},

			// ===== ID FINDER FIELDS =====
			{
				displayName: 'Search Term',
				name: 'searchTerm',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['idFinder'],
					},
				},
				description: 'Name or search term to find the resource',
			},
			{
				displayName: 'Context',
				name: 'context',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['idFinder'],
						operation: ['findFormFieldId'],
					},
				},
				description: 'Process or Blueprint ID containing the form field',
			},
			{
				displayName: 'Context Type',
				name: 'contextType',
				type: 'options',
				options: [
					{
						name: 'Process',
						value: 'process',
					},
					{
						name: 'Blueprint',
						value: 'blueprint',
					},
				],
				default: 'process',
				displayOptions: {
					show: {
						resource: ['idFinder'],
						operation: ['findFormFieldId'],
					},
				},
				description: 'Type of context for form field search',
			},

			{
				displayName: 'New Title',
				name: 'cloneTitle',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['clone'],
					},
				},
				description: 'Optional new name for the cloned template',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['blueprint'],
						operation: ['create', 'update'],
					},
				},
				options: [
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
						description: 'Short description of the template',
					},
					{
						displayName: 'Guidance',
						name: 'guidance',
						type: 'string',
						default: '',
						description: 'Guidance shown to the launcher',
					},
					{
						displayName: 'Is Public',
						name: 'is_public',
						type: 'boolean',
						default: false,
						description: 'Whether the template is public',
					},
				],
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['process'],
						operation: ['launch', 'update'],
					},
				},
				options: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Process name (use to rename on update)',
					},
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
						description: 'Process summary',
					},
					{
						displayName: 'Starred',
						name: 'starred',
						type: 'boolean',
						default: false,
						description: 'Whether the process is starred',
					},
				],
			},
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['getProcessTask', 'updateProcessTask'],
					},
				},
				description: 'The ID of the process (run) that contains the task',
			},
			{
				displayName: 'Process ID (optional)',
				name: 'processId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['complete', 'reopen'],
					},
				},
				description: 'Set for a process task to use the run-scoped path. Leave empty for a one-off task.',
			},
			{
				displayName: 'Approval Decision',
				name: 'approvalDecision',
				type: 'options',
				options: [
					{
						name: 'Not an Approval',
						value: 'none',
					},
					{
						name: 'Approve',
						value: 'approve',
					},
					{
						name: 'Reject',
						value: 'reject',
					},
				],
				default: 'none',
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['complete'],
					},
				},
				description: 'For approval steps only: whether to approve or reject',
			},
			{
				displayName: 'User ID',
				name: 'userId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['getUserTasks'],
					},
				},
				description: 'The ID of the member whose tasks to list',
			},
			{
				displayName: 'Guest ID',
				name: 'guestId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['getGuestTasks'],
					},
				},
				description: 'The guest ID (from the guest link) whose tasks to list',
			},
			{
				displayName: 'Update Fields',
				name: 'updateProcessTaskFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: {
						resource: ['task'],
						operation: ['updateProcessTask'],
					},
				},
				options: [
					{
						displayName: 'Title',
						name: 'title',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Summary',
						name: 'summary',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Deadline',
						name: 'deadline',
						type: 'dateTime',
						default: '',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'string',
						default: '',
						description: 'Task status',
					},
					{
						displayName: 'Position',
						name: 'position',
						type: 'number',
						default: 0,
					},
					{
						displayName: 'Max Assignable',
						name: 'max_assignable',
						type: 'number',
						default: 0,
					},
					{
						displayName: 'Assign Users',
						name: 'assignUsers',
						type: 'string',
						default: '',
						description: 'Comma-separated member IDs',
					},
					{
						displayName: 'Assign Guests',
						name: 'assignGuests',
						type: 'string',
						default: '',
						description: 'Comma-separated guest emails',
					},
					{
						displayName: 'Assign Groups',
						name: 'assignGroups',
						type: 'string',
						default: '',
						description: 'Comma-separated group IDs',
					},
					{
						displayName: 'Task Data (JSON)',
						name: 'taskdata',
						type: 'json',
						default: '{}',
						description: 'Form field values keyed by capture ID',
					},
				],
			},
			{
				displayName: 'Process ID',
				name: 'processId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['comment'],
						operation: ['list'],
					},
				},
				description: 'The ID of the process (run) that contains the task',
			},
			{
				displayName: 'Blueprint ID',
				name: 'blueprintId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['addField', 'updateField', 'moveField', 'deleteField', 'getDropdownOptions', 'updateDropdownOptions', 'addKickoffField', 'updateKickoffField', 'deleteKickoffField', 'reorderKickoffField'],
					},
				},
				description: 'The ID of the template (blueprint)',
			},
			{
				displayName: 'Step ID',
				name: 'stepId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['addField', 'updateField', 'moveField', 'deleteField', 'getDropdownOptions', 'updateDropdownOptions'],
					},
				},
				description: 'The ID of the step',
			},
			{
				displayName: 'Field ID',
				name: 'captureFieldId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateField', 'moveField', 'deleteField', 'getDropdownOptions', 'updateDropdownOptions'],
					},
				},
				description: 'The ID of the form field (capture)',
			},
			{
				displayName: 'Target Step ID',
				name: 'targetStepId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['moveField'],
					},
				},
				description: 'The step to move the field to',
			},
			{
				displayName: 'Position',
				name: 'fieldPosition',
				type: 'number',
				default: 1,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['moveField'],
					},
				},
				description: 'Position in the target step',
			},
			{
				displayName: 'Field Definition (JSON)',
				name: 'fieldData',
				type: 'json',
				default: '{}',
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['addField', 'updateField', 'addKickoffField', 'updateKickoffField'],
					},
				},
				description: 'Field definition. For add, include field_type and label. For update, only the properties to change (field_type is immutable).',
			},
			{
				displayName: 'Options',
				name: 'dropdownOptions',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateDropdownOptions'],
					},
				},
				description: 'One option per line (or comma-separated); replaces the full options list',
			},
			{
				displayName: 'Kickoff Field ID',
				name: 'kickoffFieldId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['updateKickoffField', 'deleteKickoffField'],
					},
				},
				description: 'The ID of the kickoff (prerun) field',
			},
			{
				displayName: 'Field Order',
				name: 'fieldOrder',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['formField'],
						operation: ['reorderKickoffField'],
					},
				},
				description: 'Comma-separated kickoff field IDs in the desired order',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['tag'],
					},
				},
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List org tags',
						action: 'Get many tags',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a tag',
						action: 'Create a tag',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a tag',
						action: 'Update a tag',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a tag',
						action: 'Delete a tag',
					},
					{
						name: 'Tag Template',
						value: 'tagTemplate',
						description: 'Attach a tag to a template',
						action: 'Tag a template',
					},
					{
						name: 'Untag Template',
						value: 'untagTemplate',
						description: 'Remove a tag from a template',
						action: 'Untag a template',
					},
					{
						name: 'Tag Process',
						value: 'tagProcess',
						description: 'Attach a tag to a process',
						action: 'Tag a process',
					},
					{
						name: 'Untag Process',
						value: 'untagProcess',
						description: 'Remove a tag from a process',
						action: 'Untag a process',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Tag ID',
				name: 'tagId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['update', 'delete', 'tagTemplate', 'tagProcess'],
					},
				},
				description: 'The ID of the tag',
			},
			{
				displayName: 'Title',
				name: 'tagTitle',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['create'],
					},
				},
				description: 'The tag title',
			},
			{
				displayName: 'Title',
				name: 'tagTitle',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['update'],
					},
				},
				description: 'New tag title',
			},
			{
				displayName: 'Color',
				name: 'tagColor',
				type: 'string',
				placeholder: '#FF5733',
				default: '',
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['create', 'update'],
					},
				},
				description: 'Optional hex color',
			},
			{
				displayName: 'Subject ID',
				name: 'subjectId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['tagTemplate', 'tagProcess'],
					},
				},
				description: 'The template or process ID to tag',
			},
			{
				displayName: 'Association ID',
				name: 'associationId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['tag'],
						operation: ['untagTemplate', 'untagProcess'],
					},
				},
				description: 'The tag-association ID (fetch the object with=tags to find it)',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['folder'],
					},
				},
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List folders',
						action: 'Get many folders',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a folder',
						action: 'Create a folder',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a folder',
						action: 'Update a folder',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a folder',
						action: 'Delete a folder',
					},
					{
						name: 'Add To Folder',
						value: 'addToFolder',
						description: 'Add a template or process to a folder',
						action: 'Add to folder',
					},
					{
						name: 'Remove From Folder',
						value: 'removeFromFolder',
						description: 'Remove an object from a folder',
						action: 'Remove from folder',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Folder Type',
				name: 'folderType',
				type: 'options',
				options: [
					{
						name: 'Template Folders',
						value: 'checklist',
					},
					{
						name: 'Process Folders',
						value: 'run',
					},
				],
				default: 'checklist',
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['getAll'],
					},
				},
				description: 'Which folder tree to list',
			},
			{
				displayName: 'Name',
				name: 'folderName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['create'],
					},
				},
				description: 'The folder name',
			},
			{
				displayName: 'Name',
				name: 'folderName',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['update'],
					},
				},
				description: 'New folder name',
			},
			{
				displayName: 'Folder ID',
				name: 'folderId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['update', 'delete', 'addToFolder'],
					},
				},
				description: 'The ID of the folder',
			},
			{
				displayName: 'Parent Folder ID',
				name: 'folderParentId',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['create', 'update'],
					},
				},
				description: 'Optional parent folder ID for nesting',
			},
			{
				displayName: 'Object Type',
				name: 'folderObjectType',
				type: 'options',
				options: [
					{
						name: 'Template',
						value: 'checklist',
					},
					{
						name: 'Process',
						value: 'run',
					},
				],
				default: 'checklist',
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['addToFolder'],
					},
				},
				description: 'Whether you are foldering a template or a process',
			},
			{
				displayName: 'Object ID',
				name: 'folderObjectId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['addToFolder'],
					},
				},
				description: 'The template or process ID to put in the folder',
			},
			{
				displayName: 'Folder Object ID',
				name: 'folderRelationId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['folder'],
						operation: ['removeFromFolder'],
					},
				},
				description: 'The folder-object relation ID to remove',
			},
			// ===== GENERAL LIST OPERATION FIELDS =====
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: {
					show: {
						operation: ['getAll', 'getMyTasks', 'getUserTasks', 'getGuestTasks'],
					},
				},
				default: false,
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				displayOptions: {
					show: {
						operation: ['getAll', 'getMyTasks', 'getUserTasks', 'getGuestTasks'],
						returnAll: [false],
					},
				},
				typeOptions: {
					minValue: 1,
					maxValue: 100,
				},
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: {
						operation: ['getAll', 'getMyTasks', 'getUserTasks', 'getGuestTasks'],
					},
				},
				options: [
					{
						displayName: 'Search',
						name: 'q',
						type: 'string',
						default: '',
						description: 'Search query',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{
								name: 'Active',
								value: 'active',
							},
							{
								name: 'Completed',
								value: 'completed',
							},
							{
								name: 'Archived',
								value: 'archived',
							},
							{
								name: 'Draft',
								value: 'draft',
							},
						],
						default: 'active',
						description: 'Filter by status',
					},
					{
						displayName: 'Tags',
						name: 'tag',
						type: 'string',
						default: '',
						description: 'Filter by tags (comma-separated)',
					},
					{
						displayName: 'Sort By',
						name: 'sort',
						type: 'options',
						options: [
							{
								name: 'Created Date (Newest)',
								value: '-created_at',
							},
							{
								name: 'Created Date (Oldest)',
								value: 'created_at',
							},
							{
								name: 'Updated Date (Newest)',
								value: '-updated_at',
							},
							{
								name: 'Updated Date (Oldest)',
								value: 'updated_at',
							},
							{
								name: 'Name (A-Z)',
								value: 'name',
							},
							{
								name: 'Name (Z-A)',
								value: '-name',
							},
						],
						default: '-created_at',
						description: 'How to sort results',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0);
		const operation = this.getNodeParameter('operation', 0);
		const credentials = await this.getCredentials('tallyfyApi');
		const baseUrl = (credentials.baseUrl as string) || 'https://go.tallyfy.com/api';
		const organizationId = credentials.organizationId as string;

		// Coerce a JSON-typed node parameter (which may arrive as a string) into an object.
		const asObject = (value: unknown): IDataObject => {
			if (typeof value === 'string') {
				return value.trim() ? (JSON.parse(value) as IDataObject) : {};
			}
			return (value as IDataObject) || {};
		};

		// Small request helper used by the read-modify-write operations (kickoff fields,
		// dropdown options, folder membership for templates) that need more than one call.
		const doRequest = async (
			reqMethod: 'GET' | 'POST' | 'PUT' | 'DELETE',
			reqEndpoint: string,
			reqBody?: IDataObject,
			reqQs?: IDataObject,
		): Promise<IDataObject> => {
			const reqOptions: IHttpRequestOptions = {
				method: reqMethod,
				url: `${baseUrl}${reqEndpoint}`,
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				},
				qs: reqQs || {},
				body: reqBody && Object.keys(reqBody).length ? reqBody : undefined,
			};
			return (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'tallyfyApi',
				reqOptions,
			)) as IDataObject;
		};

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};
				let endpoint = '';
				let method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET';
				let body: IDataObject = {};
				let qs: IDataObject = {};
				// Set true by read-modify-write branches that already ran their own requests.
				let skipGenericRequest = false;

				// Blueprint operations
				if (resource === 'blueprint') {
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/checklists`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.tag) qs.tag = filters.tag;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}`;
						method = 'GET';
					}
					
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/checklists`;
						method = 'POST';
						
						body.title = this.getNodeParameter('title', i) as string;
						body.type = this.getNodeParameter('type', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'update') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}`;
						method = 'PUT';
						
						// Title is required for blueprint updates
						body.title = this.getNodeParameter('title', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'delete') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}`;
						method = 'DELETE';
					}

					if (operation === 'clone') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/clone`;
						method = 'POST';
						// tenant is the org to clone FROM (same org here); title is the new name.
						body.tenant = organizationId;
						const cloneTitle = this.getNodeParameter('cloneTitle', i, '') as string;
						if (cloneTitle) body.title = cloneTitle;
					}

					if (operation === 'getKickoffFields') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/form-fields`;
						method = 'GET';
					}

					if (operation === 'listSteps') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps`;
						method = 'GET';
					}
				}

				// Process operations
				if (resource === 'process') {
					if (operation === 'launch') {
						endpoint = `/organizations/${organizationId}/runs`;
						method = 'POST';
						
						body.checklist_id = this.getNodeParameter('blueprintId', i) as string;
						body.name = this.getNodeParameter('processName', i) as string;
						
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/runs`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.tag) qs.tag = filters.tag;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}`;
						method = 'GET';
					}
					
					if (operation === 'update') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}`;
						method = 'PUT';
						
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'archive') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}`;
						method = 'DELETE';
					}
					
					if (operation === 'getTasks') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/tasks`;
						method = 'GET';
					}

					if (operation === 'reactivate') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/activate`;
						method = 'PUT';
					}

					if (operation === 'completeKickoffForm') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/complete-prerun`;
						method = 'POST';
					}

					if (operation === 'reopenKickoffForm') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/complete-prerun`;
						method = 'DELETE';
					}
				}

				// Task operations
				if (resource === 'task') {
					if (operation === 'createOneOff') {
						endpoint = `/organizations/${organizationId}/tasks`;
						method = 'POST';
						
						body.title = this.getNodeParameter('title', i) as string;
						body.task_type = this.getNodeParameter('task_type', i) as string;
						body.deadline = this.getNodeParameter('deadline', i) as string;
						
						// Build owners object from additional fields
						body.owners = { users: [], guests: [], groups: [] };
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						
						if (additionalFields.assignUsers) {
							(body.owners as any).users = (additionalFields.assignUsers as string).split(',').map(id => id.trim());
							delete additionalFields.assignUsers;
						}
						if (additionalFields.assignGuests) {
							(body.owners as any).guests = (additionalFields.assignGuests as string).split(',').map(email => email.trim());
							delete additionalFields.assignGuests;
						}
						if (additionalFields.assignGroups) {
							(body.owners as any).groups = (additionalFields.assignGroups as string).split(',').map(id => id.trim());
							delete additionalFields.assignGroups;
						}
						
						Object.assign(body, additionalFields);
					}
					
					if (operation === 'complete') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						// Process tasks complete run-scoped; one-off tasks complete org-scoped (V1).
						const completeProcessId = this.getNodeParameter('processId', i, '') as string;
						if (completeProcessId) {
							endpoint = `/organizations/${organizationId}/runs/${completeProcessId}/completed-tasks`;
						} else {
							endpoint = `/organizations/${organizationId}/completed-tasks`;
						}
						method = 'POST';

						body.task_id = taskId;
						// Approval-type steps require is_approved (true/false); other steps ignore it.
						const approvalDecision = this.getNodeParameter('approvalDecision', i, 'none') as string;
						if (approvalDecision === 'approve') {
							body.is_approved = true;
						} else if (approvalDecision === 'reject') {
							body.is_approved = false;
						}
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						if (additionalFields.comment) {
							body.comment = additionalFields.comment;
						}
					}
					
					if (operation === 'updateProperties') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}`;
						method = 'PUT';
						
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;
						
						// Required fields for task update
						body.title = updateFields.title || this.getNodeParameter('title', i) as string;
						body.deadline = updateFields.deadline || this.getNodeParameter('deadline', i) as string;
						
						// Handle assignee updates - owners is required
						body.owners = { users: [], guests: [], groups: [] };
						
						if (updateFields.assignUsers) {
							(body.owners as any).users = (updateFields.assignUsers as string).split(',').map(id => id.trim());
							delete updateFields.assignUsers;
						}
						if (updateFields.assignGuests) {
							(body.owners as any).guests = (updateFields.assignGuests as string).split(',').map(email => email.trim());
							delete updateFields.assignGuests;
						}
						if (updateFields.assignGroups) {
							(body.owners as any).groups = (updateFields.assignGroups as string).split(',').map(id => id.trim());
							delete updateFields.assignGroups;
						}
						
						// Remove the fields we've already handled
						delete updateFields.title;
						delete updateFields.deadline;
						
						Object.assign(body, updateFields);
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/tasks`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.tag) qs.tag = filters.tag;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}`;
						method = 'GET';
					}
					
					if (operation === 'delete') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}`;
						method = 'DELETE';
					}
					
					if (operation === 'clone') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/clone`;
						method = 'POST';
					}

					if (operation === 'getMyTasks') {
						endpoint = `/organizations/${organizationId}/me/tasks`;
						method = 'GET';

						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.sort) qs.sort = filters.sort;
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'getUserTasks') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/tasks`;
						method = 'GET';

						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						if (filters.status) qs.status = filters.status;
						if (filters.sort) qs.sort = filters.sort;
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'getGuestTasks') {
						const guestId = this.getNodeParameter('guestId', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${guestId}/tasks`;
						method = 'GET';

						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						if (filters.status) qs.status = filters.status;
						if (filters.sort) qs.sort = filters.sort;
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'reopen') {
						const taskId = this.getNodeParameter('taskId', i) as string;
						// Process tasks reopen run-scoped; one-off tasks reopen org-scoped (V2).
						const reopenProcessId = this.getNodeParameter('processId', i, '') as string;
						if (reopenProcessId) {
							endpoint = `/organizations/${organizationId}/runs/${reopenProcessId}/completed-tasks/${taskId}`;
						} else {
							endpoint = `/organizations/${organizationId}/completed-tasks/${taskId}`;
						}
						method = 'DELETE';
					}

					if (operation === 'getProcessTask') {
						const processId = this.getNodeParameter('processId', i) as string;
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/tasks/${taskId}`;
						method = 'GET';
					}

					if (operation === 'updateProcessTask') {
						const processId = this.getNodeParameter('processId', i) as string;
						const taskId = this.getNodeParameter('taskId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/tasks/${taskId}`;
						method = 'PUT';

						const f = this.getNodeParameter('updateProcessTaskFields', i) as IDataObject;
						if (f.title) body.title = f.title;
						if (f.summary) body.summary = f.summary;
						if (f.deadline) body.deadline = f.deadline;
						if (f.status) body.status = f.status;
						if (f.position !== undefined && f.position !== '') body.position = f.position;
						if (f.max_assignable !== undefined && f.max_assignable !== '') body.max_assignable = f.max_assignable;
						if (f.taskdata) body.taskdata = asObject(f.taskdata);

						if (f.assignUsers || f.assignGuests || f.assignGroups) {
							const owners: IDataObject = { users: [], guests: [], groups: [] };
							if (f.assignUsers) (owners.users as string[]) = (f.assignUsers as string).split(',').map(id => id.trim());
							if (f.assignGuests) (owners.guests as string[]) = (f.assignGuests as string).split(',').map(email => email.trim());
							if (f.assignGroups) (owners.groups as string[]) = (f.assignGroups as string).split(',').map(id => id.trim());
							body.owners = owners;
						}
					}
				}

				// Form Field operations
				if (resource === 'formField') {
					if (operation === 'getFields') {
						const contextType = this.getNodeParameter('contextType', i) as string;
						
						if (contextType === 'process') {
							const processId = this.getNodeParameter('processId', i) as string;
							endpoint = `/organizations/${organizationId}/runs/${processId}/form-fields`;
						} else {
							const blueprintId = this.getNodeParameter('blueprintId', i) as string;
							endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/form-fields`;
						}
						method = 'GET';
					}
					
					if (operation === 'updateValue') {
						const asGuest = this.getNodeParameter('asGuest', i) as boolean;
						const formFieldId = this.getNodeParameter('formFieldId', i) as string;
						const fieldValue = this.getNodeParameter('fieldValue', i) as string;
						
						if (asGuest) {
							const guestEmail = this.getNodeParameter('guestEmail', i) as string;
							endpoint = `/organizations/${organizationId}/guests/${guestEmail}/form-field/value`;
							method = 'POST';
						} else {
							endpoint = `/organizations/${organizationId}/form-field/value`;
							method = 'PUT';
						}
						
						body.id = formFieldId;
						body.form_value = fieldValue;
					}

					// Add a form field (capture) to a template step.
					if (operation === 'addField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures`;
						method = 'POST';
						body = asObject(this.getNodeParameter('fieldData', i));
					}

					// Update a form field (capture) on a template step (field_type is immutable).
					if (operation === 'updateField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures/${captureFieldId}`;
						method = 'PUT';
						body = asObject(this.getNodeParameter('fieldData', i));
					}

					// Move a form field to another step.
					if (operation === 'moveField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures/${captureFieldId}/move-out`;
						method = 'PUT';
						body.target_step_id = this.getNodeParameter('targetStepId', i) as string;
						body.position = this.getNodeParameter('fieldPosition', i, 1);
					}

					// Delete a form field from a template step.
					if (operation === 'deleteField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures/${captureFieldId}`;
						method = 'DELETE';
					}

					// Read the current options of a choice field (fetches the parent step, extracts the field).
					if (operation === 'getDropdownOptions') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						const stepResp = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}`);
						const stepData = ((stepResp.data as IDataObject) || stepResp);
						const captures = ((stepData.captures as IDataObject[]) || []);
						const field = captures.find((c: IDataObject) => c.id === captureFieldId);
						responseData = { id: captureFieldId, options: (field ? field.options : []) as IDataObject };
						skipGenericRequest = true;
					}

					// Replace the full options list on a choice field (read the capture, PUT it back with new options).
					if (operation === 'updateDropdownOptions') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const stepId = this.getNodeParameter('stepId', i) as string;
						const captureFieldId = this.getNodeParameter('captureFieldId', i) as string;
						const optionsRaw = this.getNodeParameter('dropdownOptions', i) as string;
						const optionTexts = optionsRaw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
						const formatted = optionTexts.map((text, idx) => ({ id: idx + 1, text }));

						const stepResp = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}`);
						const stepData = ((stepResp.data as IDataObject) || stepResp);
						const captures = ((stepData.captures as IDataObject[]) || []);
						const current = captures.find((c: IDataObject) => c.id === captureFieldId);
						if (!current) {
							throw new Error(`Form field ${captureFieldId} not found in step ${stepId}`);
						}
						const putBody: IDataObject = { ...current };
						delete putBody.id;
						putBody.options = formatted;
						responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${blueprintId}/steps/${stepId}/captures/${captureFieldId}`, putBody);
						skipGenericRequest = true;
					}

					// Add a kickoff (prerun) field: read the template, append, PUT it back (V6).
					if (operation === 'addKickoffField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const fieldData = asObject(this.getNodeParameter('fieldData', i));
						const tmpl = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}`, undefined, { with: 'prerun' });
						const tmplData = ((tmpl.data as IDataObject) || tmpl);
						const prerun = ((tmplData.prerun as IDataObject[]) || []);
						prerun.push(fieldData);
						responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${blueprintId}`, { title: tmplData.title, prerun });
						skipGenericRequest = true;
					}

					// Update a kickoff (prerun) field: read the template, merge changes, PUT it back (V6).
					if (operation === 'updateKickoffField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const kickoffFieldId = this.getNodeParameter('kickoffFieldId', i) as string;
						const fieldData = asObject(this.getNodeParameter('fieldData', i));
						const tmpl = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}`, undefined, { with: 'prerun' });
						const tmplData = ((tmpl.data as IDataObject) || tmpl);
						const prerun = ((tmplData.prerun as IDataObject[]) || []);
						const target = prerun.find((f: IDataObject) => f.id === kickoffFieldId);
						if (!target) {
							throw new Error(`Kickoff field ${kickoffFieldId} not found on template ${blueprintId}`);
						}
						Object.assign(target, fieldData);
						responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${blueprintId}`, { title: tmplData.title, prerun });
						skipGenericRequest = true;
					}

					// Delete a kickoff (prerun) field (dedicated endpoint).
					if (operation === 'deleteKickoffField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const kickoffFieldId = this.getNodeParameter('kickoffFieldId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/${blueprintId}/preruns/${kickoffFieldId}`;
						method = 'DELETE';
					}

					// Reorder kickoff (prerun) fields by writing explicit positions, then PUT (V6).
					if (operation === 'reorderKickoffField') {
						const blueprintId = this.getNodeParameter('blueprintId', i) as string;
						const orderRaw = this.getNodeParameter('fieldOrder', i) as string;
						const order = orderRaw.split(',').map(s => s.trim()).filter(Boolean);
						const tmpl = await doRequest('GET', `/organizations/${organizationId}/checklists/${blueprintId}`, undefined, { with: 'prerun' });
						const tmplData = ((tmpl.data as IDataObject) || tmpl);
						const prerun = ((tmplData.prerun as IDataObject[]) || []);
						const byId: IDataObject = {};
						for (const f of prerun) {
							if (f.id) byId[f.id as string] = f;
						}
						const reordered: IDataObject[] = [];
						let pos = 1;
						for (const fid of order) {
							const item = byId[fid] as IDataObject;
							if (!item) {
								throw new Error(`Kickoff field ${fid} not found on template ${blueprintId}`);
							}
							item.position = pos++;
							reordered.push(item);
							delete byId[fid];
						}
						// Append any fields the caller omitted, continuing the position sequence.
						for (const f of prerun) {
							if (f.id && byId[f.id as string]) {
								f.position = pos++;
								reordered.push(f);
							}
						}
						responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${blueprintId}`, { title: tmplData.title, prerun: reordered });
						skipGenericRequest = true;
					}
				}

				// Comment operations
				if (resource === 'comment') {
					const taskId = this.getNodeParameter('taskId', i, '') as string;
					
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/comment`;
						method = 'POST';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'createBot') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/bot-comment`;
						method = 'POST';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'reportProblem') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/problem`;
						method = 'POST';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'resolveIssue') {
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/resolved-threads`;
						method = 'POST';
						// Resolve issue requires both thread_id and content
						body.thread_id = this.getNodeParameter('threadId', i) as string;
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'update') {
						const commentId = this.getNodeParameter('commentId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/comment/${commentId}`;
						method = 'PUT';
						body.content = this.getNodeParameter('content', i) as string;
					}
					
					if (operation === 'delete') {
						const commentId = this.getNodeParameter('commentId', i) as string;
						endpoint = `/organizations/${organizationId}/tasks/${taskId}/comment/${commentId}`;
						method = 'DELETE';
					}

					// List all comments/threads on a process task (embedded via with=threads).
					if (operation === 'list') {
						const processId = this.getNodeParameter('processId', i) as string;
						endpoint = `/organizations/${organizationId}/runs/${processId}/tasks/${taskId}`;
						method = 'GET';
						qs.with = 'threads';
					}
				}

				// User operations
				if (resource === 'user') {
					if (operation === 'getCurrent') {
						endpoint = '/me';
						method = 'GET';
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/users`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}`;
						method = 'GET';
					}
					
					if (operation === 'invite') {
						endpoint = `/organizations/${organizationId}/users/invite`;
						method = 'POST';
						
						body.email = this.getNodeParameter('email', i) as string;
						body.first_name = this.getNodeParameter('firstName', i) as string;
						body.last_name = this.getNodeParameter('lastName', i) as string;
						body.role = this.getNodeParameter('role', i) as string;
						body.message = this.getNodeParameter('message', i) as string;
					}
					
					if (operation === 'updateRole') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/role`;
						method = 'PUT';
						body.role = this.getNodeParameter('role', i) as string;
					}
					
					if (operation === 'disable') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/disable`;
						method = 'DELETE';
					}
					
					if (operation === 'enable') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/enable`;
						method = 'PUT';
					}
					
					if (operation === 'convertToGuest') {
						const userId = this.getNodeParameter('userId', i) as string;
						endpoint = `/organizations/${organizationId}/users/${userId}/to/guest`;
						method = 'PUT';
					}

					if (operation === 'getOrganization') {
						endpoint = `/organizations/${organizationId}`;
						method = 'GET';
					}
				}

				// Guest operations
				if (resource === 'guest') {
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/guests`;
						method = 'POST';
						
						body.email = this.getNodeParameter('email', i) as string;
						const firstName = this.getNodeParameter('firstName', i, '') as string;
						const lastName = this.getNodeParameter('lastName', i, '') as string;
						if (firstName) body.first_name = firstName;
						if (lastName) body.last_name = lastName;
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/guests`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						
						if (filters.q) qs.q = filters.q;
						if (filters.sort) qs.sort = filters.sort;
						
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}`;
						method = 'GET';
					}
					
					if (operation === 'update') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}`;
						method = 'PUT';
						
						const firstName = this.getNodeParameter('firstName', i, '') as string;
						const lastName = this.getNodeParameter('lastName', i, '') as string;
						if (firstName) body.first_name = firstName;
						if (lastName) body.last_name = lastName;
					}
					
					if (operation === 'delete') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}`;
						method = 'DELETE';
					}
					
					if (operation === 'convertToMember') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}/to/member`;
						method = 'POST';
					}

					if (operation === 'enable') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}/enable`;
						method = 'PUT';
					}

					if (operation === 'disable') {
						const email = this.getNodeParameter('email', i) as string;
						endpoint = `/organizations/${organizationId}/guests/${email}/disable`;
						method = 'DELETE';
					}
				}

				// Group operations
				if (resource === 'group') {
					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/groups`;
						method = 'POST';
						
						body.name = this.getNodeParameter('name', i) as string;
						body.description = this.getNodeParameter('description', i, '') as string;
						
						const members = this.getNodeParameter('members', i, '') as string;
						const guests = this.getNodeParameter('guests', i, '') as string;
						
						if (members) {
							body.members = members.split(',').map(id => id.trim());
						}
						if (guests) {
							body.guests = guests.split(',').map(email => email.trim());
						}
					}
					
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/groups`;
						method = 'GET';
						
						const returnAll = this.getNodeParameter('returnAll', i);
						if (!returnAll) {
							qs.limit = this.getNodeParameter('limit', i);
						}
					}
					
					if (operation === 'get') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						endpoint = `/organizations/${organizationId}/groups/${groupId}`;
						method = 'GET';
					}
					
					if (operation === 'update') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						endpoint = `/organizations/${organizationId}/groups/${groupId}`;
						method = 'PUT';
						
						const description = this.getNodeParameter('description', i, '') as string;
						const members = this.getNodeParameter('members', i, '') as string;
						const guests = this.getNodeParameter('guests', i, '') as string;
						
						if (description) body.description = description;
						if (members) body.members = members.split(',').map(id => id.trim());
						if (guests) body.guests = guests.split(',').map(email => email.trim());
					}
					
					if (operation === 'delete') {
						const groupId = this.getNodeParameter('groupId', i) as string;
						endpoint = `/organizations/${organizationId}/groups/${groupId}`;
						method = 'DELETE';
					}
				}

				// Search operations
				if (resource === 'search') {
					endpoint = `/organizations/${organizationId}/search`;
					method = 'GET';
					
					qs.search = this.getNodeParameter('searchQuery', i) as string;
					
					if (operation === 'global') {
						const searchIn = this.getNodeParameter('searchIn', i) as string[];
						qs.on = searchIn.join(',');
					} else if (operation === 'tasks') {
						qs.on = 'task';
					} else if (operation === 'processes') {
						qs.on = 'process';
					} else if (operation === 'blueprints') {
						qs.on = 'blueprint';
					} else if (operation === 'snippets') {
						qs.on = 'snippet';
					}
					
					qs.per_page = 50;
				}

				// ID Finder operations
				if (resource === 'idFinder') {
					const searchTerm = this.getNodeParameter('searchTerm', i) as string;
					
					if (operation === 'findProcessId') {
						endpoint = `/organizations/${organizationId}/runs`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findTaskId') {
						endpoint = `/organizations/${organizationId}/tasks`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findBlueprintId') {
						endpoint = `/organizations/${organizationId}/checklists`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findFormFieldId') {
						const context = this.getNodeParameter('context', i) as string;
						const contextType = this.getNodeParameter('contextType', i) as string;
						
						if (contextType === 'process') {
							endpoint = `/organizations/${organizationId}/runs/${context}/form-fields`;
						} else {
							endpoint = `/organizations/${organizationId}/checklists/${context}/form-fields`;
						}
						method = 'GET';
					}
					
					if (operation === 'findUserId') {
						endpoint = `/organizations/${organizationId}/users`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
					
					if (operation === 'findGroupId') {
						endpoint = `/organizations/${organizationId}/groups`;
						method = 'GET';
						qs.q = searchTerm;
						qs.per_page = 10;
					}
				}

				// Tag operations
				if (resource === 'tag') {
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/tags`;
						method = 'GET';

						const returnAll = this.getNodeParameter('returnAll', i);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						if (filters.q) qs.q = filters.q;
						if (filters.status) qs.status = filters.status;
						if (filters.sort) qs.sort = filters.sort;
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/tags`;
						method = 'POST';
						body.title = this.getNodeParameter('tagTitle', i) as string;
						const tagColor = this.getNodeParameter('tagColor', i, '') as string;
						if (tagColor) body.color = tagColor;
					}

					if (operation === 'update') {
						const tagId = this.getNodeParameter('tagId', i) as string;
						endpoint = `/organizations/${organizationId}/tags/${tagId}`;
						method = 'PUT';
						const tagTitle = this.getNodeParameter('tagTitle', i, '') as string;
						const tagColor = this.getNodeParameter('tagColor', i, '') as string;
						if (tagTitle) body.title = tagTitle;
						if (tagColor) body.color = tagColor;
					}

					if (operation === 'delete') {
						const tagId = this.getNodeParameter('tagId', i) as string;
						endpoint = `/organizations/${organizationId}/tags/${tagId}`;
						method = 'DELETE';
					}

					// Tag/untag use ONE association endpoint for both templates and processes (V7).
					if (operation === 'tagTemplate') {
						endpoint = `/organizations/${organizationId}/checklists/tags`;
						method = 'POST';
						body.subject_id = this.getNodeParameter('subjectId', i) as string;
						body.subject_type = 'Checklist';
						body.tag_id = this.getNodeParameter('tagId', i) as string;
						body.tag_type = 'private';
					}

					if (operation === 'tagProcess') {
						endpoint = `/organizations/${organizationId}/checklists/tags`;
						method = 'POST';
						body.subject_id = this.getNodeParameter('subjectId', i) as string;
						body.subject_type = 'Run';
						body.tag_id = this.getNodeParameter('tagId', i) as string;
						body.tag_type = 'private';
					}

					// Untag needs the tag-association id (fetch the object with=tags to find it).
					if (operation === 'untagTemplate' || operation === 'untagProcess') {
						const associationId = this.getNodeParameter('associationId', i) as string;
						endpoint = `/organizations/${organizationId}/checklists/tags/${associationId}`;
						method = 'DELETE';
					}
				}

				// Folder operations
				if (resource === 'folder') {
					if (operation === 'getAll') {
						endpoint = `/organizations/${organizationId}/folders`;
						method = 'GET';
						qs.folder_type = this.getNodeParameter('folderType', i) as string;
						qs.with = 'children';
						qs.sort = 'position';

						const returnAll = this.getNodeParameter('returnAll', i);
						if (!returnAll) qs.limit = this.getNodeParameter('limit', i);
					}

					if (operation === 'create') {
						endpoint = `/organizations/${organizationId}/folders`;
						method = 'POST';
						body.name = this.getNodeParameter('folderName', i) as string;
						const parentId = this.getNodeParameter('folderParentId', i, '') as string;
						if (parentId) body.parent_id = parentId;
					}

					if (operation === 'update') {
						const folderId = this.getNodeParameter('folderId', i) as string;
						endpoint = `/organizations/${organizationId}/folders/${folderId}`;
						method = 'PUT';
						const folderName = this.getNodeParameter('folderName', i, '') as string;
						const parentId = this.getNodeParameter('folderParentId', i, '') as string;
						if (folderName) body.name = folderName;
						if (parentId) body.parent_id = parentId;
					}

					if (operation === 'delete') {
						const folderId = this.getNodeParameter('folderId', i) as string;
						endpoint = `/organizations/${organizationId}/folders/${folderId}`;
						method = 'DELETE';
					}

					// Add To Folder is asymmetric: templates are foldered on the checklist itself,
					// processes via the add-object endpoint (V8).
					if (operation === 'addToFolder') {
						const folderId = this.getNodeParameter('folderId', i) as string;
						const objectId = this.getNodeParameter('folderObjectId', i) as string;
						const objectType = this.getNodeParameter('folderObjectType', i) as string;
						if (objectType === 'checklist') {
							// The checklist PUT requires title, so fetch it first.
							const tmpl = await doRequest('GET', `/organizations/${organizationId}/checklists/${objectId}`);
							const tmplData = ((tmpl.data as IDataObject) || tmpl);
							responseData = await doRequest('PUT', `/organizations/${organizationId}/checklists/${objectId}`, { title: tmplData.title, folder_id: folderId });
							skipGenericRequest = true;
						} else {
							endpoint = `/organizations/${organizationId}/folders/add-object`;
							method = 'POST';
							body.folder_id = folderId;
							body.subject_id = objectId;
							body.subject_type = 'Run';
						}
					}

					if (operation === 'removeFromFolder') {
						const folderObjectId = this.getNodeParameter('folderRelationId', i) as string;
						endpoint = `/organizations/${organizationId}/folders-objects/${folderObjectId}`;
						method = 'DELETE';
					}
				}

				// Make the API request (skipped when a read-modify-write branch already ran)
				if (!skipGenericRequest) {
				const options: IHttpRequestOptions = {
					method,
					url: `${baseUrl}${endpoint}`,
					headers: {
						'Accept': 'application/json',
						'Content-Type': 'application/json',
					},
					qs,
					body: Object.keys(body).length ? body : undefined,
				};

				responseData = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'tallyfyApi',
					options,
				);

				// Handle pagination if needed
				if (operation === 'getAll' && this.getNodeParameter('returnAll', i)) {
					const allItems: IDataObject[] = [];
					let hasMore = true;
					let page = 1;

					while (hasMore) {
						options.qs = { ...qs, page };
						const pageData = await this.helpers.httpRequestWithAuthentication.call(
							this,
							'tallyfyApi',
							options,
						);

						if (Array.isArray(pageData.data)) {
							allItems.push(...pageData.data);
						}

						if (!pageData.meta?.pagination?.has_more_pages) {
							hasMore = false;
						}
						page++;
					}
					responseData = allItems;
				}
				}

				// Comment list returns the task object with threads embedded; surface the threads
				if (resource === 'comment' && operation === 'list') {
					const taskObj = ((responseData as IDataObject).data as IDataObject) || (responseData as IDataObject);
					const threadsWrapper = (taskObj?.threads as IDataObject) || {};
					responseData = ((threadsWrapper.data as IDataObject[]) || []);
				}

				// Special handling for ID Finder - return simplified results
				if (resource === 'idFinder') {
					let results: any[] = [];
					if (Array.isArray(responseData)) {
						results = responseData;
					} else if (typeof responseData === 'object' && responseData !== null && 'data' in responseData) {
						results = (responseData as IDataObject).data as any[] || [];
					}
					
					if (results.length > 0) {
						responseData = results.map((item: any) => ({
							id: item.id,
							name: item.name || item.title || item.label || item.email || 'Unknown',
							type: operation.replace('find', '').replace('Id', ''),
						}));
					}
				}

				// Format response
				if (Array.isArray(responseData)) {
					returnData.push(...responseData.map(item => ({ json: item })));
				} else {
					returnData.push({ json: responseData });
				}

			} catch (error) {
				if (this.continueOnFail()) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					returnData.push({ json: { error: errorMessage } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}