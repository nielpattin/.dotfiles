import { storage } from './storage';

const MODEL_PROVIDER_KEY = 'plannotator-model-provider';
const MODEL_ID_KEY = 'plannotator-model-id';

export interface ModelSettings {
  providerID?: string;
  modelID?: string;
}

export function getModelSettings(): ModelSettings {
  const providerID = storage.getItem(MODEL_PROVIDER_KEY) || undefined;
  const modelID = storage.getItem(MODEL_ID_KEY) || undefined;

  return { providerID, modelID };
}

export function saveModelSettings(settings: ModelSettings): void {
  if (settings.providerID) {
    storage.setItem(MODEL_PROVIDER_KEY, settings.providerID);
  } else {
    storage.removeItem(MODEL_PROVIDER_KEY);
  }

  if (settings.modelID) {
    storage.setItem(MODEL_ID_KEY, settings.modelID);
  } else {
    storage.removeItem(MODEL_ID_KEY);
  }
}
