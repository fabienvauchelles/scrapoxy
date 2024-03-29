import { Module } from '@nestjs/common';
import { STORAGE_MEMORY_MODULE_CONFIG } from './memory.constants';
import { StorageMemoryService } from './memory.service';
import { EventsModule } from '../../../events';
import { ProbeprovidersModule } from '../../../probe';
import { StorageprovidersModule } from '../../providers.module';
import type { IStorageLocalModuleConfig } from '../local.interface';
import type { DynamicModule } from '@nestjs/common';


export type IStorageMemoryModuleConfig = IStorageLocalModuleConfig;


@Module({})
export class StorageMemoryModule {
    static forRoot(): DynamicModule {
        const config: IStorageMemoryModuleConfig = {
            certificatesMax: parseInt(
                process.env.STORAGE_FILE_CERTIFICATES_MAX ?? '1000',
                0
            ),
        };

        return {
            module: StorageMemoryModule,
            imports: [
                EventsModule, ProbeprovidersModule, StorageprovidersModule,
            ],
            providers: [
                {
                    provide: STORAGE_MEMORY_MODULE_CONFIG,
                    useValue: config,
                },
                StorageMemoryService,
            ],
        };
    }
}
