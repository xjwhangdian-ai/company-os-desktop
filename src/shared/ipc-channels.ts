export const IPC = {
  configGet: 'config:get',
  configPickDataDir: 'config:pick-data-dir',
  configSetActiveProvider: 'config:set-active-provider',
  configSetProviderConfig: 'config:set-provider-config',

  configAddCompany: 'config:add-company',
  configRemoveCompany: 'config:remove-company',
  configSetCompanyDataDir: 'config:set-company-data-dir',
  configSetActiveCompany: 'config:set-active-company',

  agentsList: 'agents:list',
  agentRun: 'agent:run',
  agentCancel: 'agent:cancel',
  agentStreamEvent: 'agent:stream-event',

  dialogPickFiles: 'dialog:pick-files',
  shellShowItemInFolder: 'shell:show-item-in-folder',
  shellSaveAsCopy: 'shell:save-as-copy',

  uploadGeneric: 'upload:generic',
  uploadBiddingRoot: 'upload:bidding-root',
  uploadBiddingMaterial: 'upload:bidding-material',
  uploadLegalPending: 'upload:legal-pending',

  outputsScan: 'outputs:scan',

  biddingListProjects: 'bidding:list-projects',
  biddingMaterialCounts: 'bidding:material-counts',

  legalListDocs: 'legal:list-docs',
  legalMarkReviewed: 'legal:mark-reviewed',
  legalListTemplates: 'legal:list-templates',
  legalUploadTemplate: 'legal:upload-template',

  docgenExportMarkdownFile: 'docgen:export-markdown-file',
  docgenExportBiddingTriSplit: 'docgen:export-bidding-tri-split',

  gzhRunStyle: 'gzh:run-style',
  shellOpenPath: 'shell:open-path',

  identityList: 'identity:list',
  identityAdd: 'identity:add',
  identityRemove: 'identity:remove',
  identityVerifyPin: 'identity:verify-pin'
} as const
