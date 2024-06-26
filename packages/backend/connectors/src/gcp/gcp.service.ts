import { Logger } from '@nestjs/common';
import {
    Agents,
    TRANSPORT_DATACENTER_TYPE,
} from '@scrapoxy/backend-sdk';
import {
    CONNECTOR_GCP_TYPE,
    EProxyStatus,
    randomNames,
} from '@scrapoxy/common';
import { GcpApi } from './api';
import { getGcpExternalIp } from './gcp.helpers';
import { EGcpInstanceStatus } from './gcp.interface';
import type {
    IConnectorGcpConfig,
    IConnectorGcpCredential,
    IGcpInstance,
} from './gcp.interface';
import type {
    IConnectorService,
    ITransportProxyRefreshedConfigDatacenter,
} from '@scrapoxy/backend-sdk';
import type {
    IConnectorProxyRefreshed,
    IProxyKeyToRemove,
} from '@scrapoxy/common';


function convertStatus(status: EGcpInstanceStatus): EProxyStatus {
    if (!status) {
        return EProxyStatus.ERROR;
    }

    switch (status) {
        case EGcpInstanceStatus.RUNNING:
            return EProxyStatus.STARTED;

        case EGcpInstanceStatus.PROVISIONING:
        case EGcpInstanceStatus.STAGING:
            return EProxyStatus.STARTING;

        case EGcpInstanceStatus.SUSPENDED:
        case EGcpInstanceStatus.TERMINATED:
            return EProxyStatus.STOPPED;

        case EGcpInstanceStatus.SUSPENDING:
        case EGcpInstanceStatus.STOPPING:
            return EProxyStatus.STOPPING;

        default:
            return EProxyStatus.ERROR;
    }
}


function convertToProxy(
    instance: IGcpInstance, port: number
): IConnectorProxyRefreshed {
    const hostname = getGcpExternalIp(instance);
    const config: ITransportProxyRefreshedConfigDatacenter = {
        address: hostname ? {
            hostname,
            port,
        } : void 0,
    };
    const proxy: IConnectorProxyRefreshed = {
        type: CONNECTOR_GCP_TYPE,
        transportType: TRANSPORT_DATACENTER_TYPE,
        key: instance.name as string,
        name: instance.name as string,
        config,
        status: convertStatus(instance.status),
    };

    return proxy;
}


export class ConnectorGcpService implements IConnectorService {
    private readonly logger = new Logger(ConnectorGcpService.name);

    private readonly api: GcpApi;

    constructor(
        credentialConfig: IConnectorGcpCredential,
        private readonly connectorConfig: IConnectorGcpConfig,
        agents: Agents
    ) {
        this.api = new GcpApi(
            credentialConfig.projectId,
            credentialConfig.clientEmail,
            credentialConfig.privateKeyId,
            credentialConfig.privateKey,
            agents
        );
    }

    async getProxies(): Promise<IConnectorProxyRefreshed[]> {
        this.logger.debug('getProxies()');

        const instances = await this.api.listInstances(
            this.connectorConfig.zone,
            this.connectorConfig.label
        );

        return instances.map((i) => convertToProxy(
            i,
            this.connectorConfig.port
        ));
    }

    async createProxies(count: number): Promise<IConnectorProxyRefreshed[]> {
        this.logger.debug(`createProxies(): count=${count}`);

        await this.api.bulkInsertInstances({
            instancesNames: randomNames(count),
            labelName: this.connectorConfig.label,
            machineType: this.connectorConfig.machineType,
            templateName: this.connectorConfig.templateName,
            zone: this.connectorConfig.zone,
        });

        return [];
    }

    async startProxies(keys: string[]): Promise<void> {
        this.logger.debug(`startProxies(): keys.length=${keys.length}`);

        await Promise.all(keys.map((key) => this.api.startInstance(
            this.connectorConfig.zone,
            key
        )));
    }

    async removeProxies(keys: IProxyKeyToRemove[]): Promise<string[]> {
        this.logger.debug(`removeProxies(): keys.length=${keys.length}`);

        await Promise.all(keys.map((p) => this.api.deleteInstance(
            this.connectorConfig.zone,
            p.key
        )));

        return [];
    }
}
