import { DocumentTemplateType, Role } from '@prisma/client';
import { DocumentRendererService } from '../src/modules/document-engine/renderer/document-renderer.service';
import { PdfEngineService } from '../src/modules/document-engine/pdf/pdf-engine.service';
import type { DocumentBlueprint } from '../src/modules/document-engine/blueprint/document-blueprint.types';
import { LayoutEngine } from '../src/modules/document-engine/layout/layout-engine.service';
import { DocumentMeasureService } from '../src/modules/document-engine/measurement/document-measure.service';
import { DocumentBuilderService } from '../src/modules/document-engine/builder/document-builder.service';
import { DocumentContextService } from '../src/modules/document-engine/context/document-context.service';
import { OperationsService } from '../src/modules/operations/operations.service';
import { DocumentEngineService } from '../src/modules/document-engine/document-engine.service';
import type {
  RenderedDocument,
  RenderedImage,
} from '../src/modules/document-engine/renderer/document-renderer.types';
import { DocumentAssetResolver } from '../src/modules/document-engine/assets/document-asset-resolver.service';
import { PNG } from 'pngjs';
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library';
import { DOCUMENT_PAGE } from '../src/shared/constants/document-engine.constants';

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function blueprint(rowCount: number): DocumentBlueprint {
  return {
    version: '1.0',
    metadata: {
      operationId: '7db71471-0cf4-4414-8d06-83eb9c1917c9',
      documentId: null,
      documentType: DocumentTemplateType.WORK_ORDER,
      documentNumber: 'OS-000001',
      generatedAt: '2026-06-29T10:00:00.000Z',
      locale: 'pt-BR',
      timezone: 'America/Recife',
      currency: 'BRL',
      organization: {
        legalName: 'ERP Operation',
        tradeName: 'ERP Operation',
        cnpj: '00.000.000/0001-00',
        email: 'contato@example.com',
        phone: '+55 81 99999-9999',
        website: 'https://orbit.local',
        address: 'Rua Orbit, 100 · Recife/PE',
        city: 'Recife',
        state: 'PE',
        primaryColor: '#111827',
        secondaryColor: '#2563EB',
      },
    },
    header: {
      title: 'Ordem de Serviço',
      organizationName: 'ERP Operation',
      documentNumber: 'OS-000001',
    },
    footer: {
      content: 'Gerado por ERP Operation',
      generatedAt: '2026-06-29T10:00:00.000Z',
    },
    sections: [
      {
        id: 'summary',
        title: 'Resumo',
        critical: true,
        components: [
          {
            id: 'metadata',
            kind: 'metadata',
            keepTogether: true,
            items: [
              { label: 'Cliente', value: 'Hospital Santa Clara' },
              { label: 'Operador', value: 'João Técnico' },
            ],
          },
        ],
      },
      {
        id: 'table',
        title: 'Tabela longa',
        components: [
          {
            id: 'rows',
            kind: 'table',
            columns: [
              { key: 'idx', label: '#', width: 0.12 },
              { key: 'name', label: 'Item', width: 0.58 },
              { key: 'status', label: 'Status', width: 0.3 },
            ],
            rows: Array.from({ length: rowCount }).map((_, index) => ({
              idx: String(index + 1),
              name: `Item ${index + 1}`,
              status: index % 2 === 0 ? 'OK' : 'Pendente',
            })),
          },
        ],
      },
    ],
  };
}

describe('DocumentEngine foundation', () => {
  const renderer = (): DocumentRendererService =>
    new DocumentRendererService(new LayoutEngine(new DocumentMeasureService()));

  it('paginates long tables without producing empty pages', () => {
    const rendered = renderer().render(blueprint(95));
    expect(rendered.pages.length).toBeGreaterThan(1);
    expect(rendered.pages.every((page) => page.elements.length > 0)).toBe(true);
  });

  it('generates a direct PDF buffer with PDF header and pages', async () => {
    const rendered = renderer().render(blueprint(12));
    const result = await new PdfEngineService().create(rendered);
    expect(result.pageCount).toBe(rendered.pages.length);
    expect(result.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(result.buffer.toString('latin1')).toContain('/Type /Page');
  });

  it('generates a scannable equipment QR and preserves the same image in Blueprint and PDF', async () => {
    const payload = 'equipment:7de712a5-692a-481f-b080-189e518628c0';
    const asset = await new DocumentAssetResolver({} as never).generateQrCode(payload);
    const png = PNG.sync.read(Buffer.from(asset.contentBase64, 'base64'));
    const luminance = new Uint8ClampedArray(png.width * png.height);
    for (let index = 0; index < luminance.length; index += 1) {
      const offset = index * 4;
      luminance[index] = Math.round(
        (png.data[offset] + 2 * png.data[offset + 1] + png.data[offset + 2]) / 4,
      );
    }
    const source = new RGBLuminanceSource(luminance, png.width, png.height);
    const decoded = new QRCodeReader()
      .decode(new BinaryBitmap(new HybridBinarizer(source)))
      .getText();
    expect(decoded).toBe(payload);
    const doc = blueprint(1);
    doc.sections.push({
      id: 'qr',
      title: 'QR',
      components: [
        {
          id: 'equipment-qr',
          kind: 'qrCode',
          label: 'QR do equipamento',
          value: payload,
          image: {
            mimeType: 'image/png',
            fileSize: asset.fileSize,
            contentBase64: asset.contentBase64,
          },
        },
      ],
    });
    const rendered = renderer().render(doc);
    const pdf = await new PdfEngineService().create(rendered);
    const qr = doc.sections.at(-1)?.components[0];
    expect(qr?.kind === 'qrCode' ? qr.image.contentBase64 : null).toBe(asset.contentBase64);
    expect(
      rendered.pages
        .flatMap((page) => page.elements)
        .some(
          (element) => element.type === 'image' && element.contentBase64 === asset.contentBase64,
        ),
    ).toBe(true);
    expect(pdf.buffer.toString('latin1')).toContain('/Subtype /Image');
  });

  it('embeds a Unicode font without stripping Portuguese text and punctuation', async () => {
    const unicodeSample = 'á à â ã é ê í ó ô õ ú ç Á É Í Ó Ú Ç º ª – — R$';
    const rendered: RenderedDocument = {
      blueprint: {
        version: '1.0',
        metadata: {
          operationId: 'unicode-punctuation',
          documentId: 'unicode-punctuation',
          documentNumber: 'DOC-UNICODE',
          documentType: 'REPORT',
          generatedAt: new Date('2026-07-10T12:00:00.000Z').toISOString(),
          locale: 'pt-BR',
          timezone: 'America/Recife',
          currency: 'BRL',
          organization: {
            legalName: 'Orbit ERP',
            tradeName: 'Orbit ERP',
            cnpj: '',
            email: '',
            phone: '',
            website: '',
            address: '',
            city: '',
            state: '',
            primaryColor: '#000000',
            secondaryColor: '#000000',
          },
        },
        header: {
          title: 'Exportação — “produção”',
          subtitle: 'PDF-safe',
          organizationName: 'Orbit ERP',
          documentNumber: 'DOC-UNICODE',
        },
        footer: {
          content: 'Footer',
          generatedAt: new Date('2026-07-10T12:00:00.000Z').toISOString(),
        },
        sections: [],
      },
      pages: [
        {
          pageNumber: 1,
          elements: [
            {
              type: 'text',
              text: unicodeSample,
              x: 40,
              y: 760,
              size: 10,
            },
          ],
        },
      ],
    };
    const result = await new PdfEngineService().create(rendered);
    const latin1 = result.buffer.toString('latin1');
    expect(rendered.pages[0]?.elements[0]).toMatchObject({ text: unicodeSample });
    expect(latin1).toContain('%PDF-');
    expect(latin1).toContain('/ToUnicode');
    expect(latin1).toContain('/FontFile');
  });

  it('measures text and computes printable layout boundaries', () => {
    const measure = new DocumentMeasureService();
    const layout = new LayoutEngine(measure);
    const wrapped = layout.wrapText('texto operacional para medição de layout', 90, 10);

    expect(measure.measureText({ text: 'ERP', width: 80, fontSize: 10 }).height).toBeGreaterThan(0);
    expect(layout.contentWidth()).toBeGreaterThan(400);
    expect(layout.availableHeight()).toBeGreaterThan(500);
    expect(wrapped.length).toBeGreaterThan(1);
  });

  it('keeps signature blocks together and embeds fixed signature images in the PDF', async () => {
    const doc = blueprint(55);
    doc.sections.push({
      id: 'signature',
      title: 'Assinatura',
      critical: true,
      components: [
        {
          id: 'document-signature',
          kind: 'signature',
          mode: 'HYBRID',
          keepTogether: true,
          signatures: [
            {
              id: 'fixed',
              role: 'fixed',
              label: 'Assinatura fixa',
              name: 'Responsável Técnico',
              title: 'Eng. Mecânico',
              signedAt: null,
              caption: 'Assinatura cadastrada',
              image: {
                mimeType: 'image/png',
                fileSize: Buffer.from(ONE_PIXEL_PNG, 'base64').length,
                contentBase64: ONE_PIXEL_PNG,
              },
            },
            {
              id: 'collected',
              role: 'collected',
              label: 'Assinatura do cliente',
              name: 'Maria Cliente',
              title: 'Responsável pelo local',
              signedAt: '2026-07-17T15:42:00.000Z',
              caption: 'Assinatura coletada em campo',
              image: null,
            },
          ],
        },
      ],
    });

    const rendered = renderer().render(doc);
    const signaturePages = rendered.pages.filter((page) =>
      page.elements.some((element) => element.type === 'image'),
    );
    const result = await new PdfEngineService().create(rendered);

    expect(signaturePages).toHaveLength(1);
    const signatureTexts = signaturePages.flatMap((page) => page.elements)
      .filter((element) => element.type === 'text')
      .map((element) => element.text);
    expect(signatureTexts).toContain('Assinado em: 17/07/2026, 12:42');
    expect(result.buffer.toString('latin1')).toContain('/Subtype /Image');
    expect(result.buffer.toString('latin1')).toContain('/XObject');
  });

  it('builds multiple institutional signatures together with an execution signature', () => {
    const context = operationContext(DocumentTemplateType.WORK_ORDER);
    context.signature = {
      requiresSignature: true,
      signatureMode: 'HYBRID',
      signatureId: 'institutional-1',
      fixedSignature: null,
      institutionalSignatures: [
        {
          id: 'institutional-1',
          name: 'Ana',
          title: 'Responsável técnica',
          professionalCouncil: 'CREA 123',
          department: 'Engenharia',
          image: {
            storageKey: 'a',
            mimeType: 'image/png',
            fileSize: 68,
            contentBase64: ONE_PIXEL_PNG,
          },
        },
        {
          id: 'institutional-2',
          name: 'Bruno',
          title: 'Diretor técnico',
          professionalCouncil: null,
          department: 'Diretoria',
          image: {
            storageKey: 'b',
            mimeType: 'image/png',
            fileSize: 68,
            contentBase64: ONE_PIXEL_PNG,
          },
        },
      ],
      collectedSignature: null,
      executionSignatures: [
        {
          role: 'client',
          label: 'Assinatura do cliente',
          name: null,
          title: null,
          signedAt: null,
          caption: 'Coletada na execução',
          image: null,
        },
      ],
    };
    const builder = new DocumentBuilderService({} as never);
    const built = (
      builder as unknown as { buildFromContext: (ctx: unknown) => DocumentBlueprint }
    ).buildFromContext(context);
    const component = built.sections
      .flatMap((section) => section.components)
      .find((item) => item.kind === 'signature');
    expect(component && 'signatures' in component ? component.signatures : []).toHaveLength(3);
  });

  it('builds semantically different Technical Report and Technical Opinion blueprints', () => {
    const builder = new DocumentBuilderService({} as never);
    const base = operationContext(DocumentTemplateType.TECHNICAL_REPORT);
    const report = (
      builder as unknown as { buildFromContext: (ctx: unknown) => DocumentBlueprint }
    ).buildFromContext(base);
    const opinion = (
      builder as unknown as { buildFromContext: (ctx: unknown) => DocumentBlueprint }
    ).buildFromContext({
      ...base,
      configuration: { ...base.configuration, type: DocumentTemplateType.TECHNICAL_OPINION },
    });

    const reportSectionIds = report.sections.map((section) => section.id);
    const opinionSectionIds = opinion.sections.map((section) => section.id);

    expect(report.metadata.documentType).toBe(DocumentTemplateType.TECHNICAL_REPORT);
    expect(opinion.metadata.documentType).toBe(DocumentTemplateType.TECHNICAL_OPINION);
    expect(reportSectionIds).toContain('technical-report-identification');
    expect(reportSectionIds).toContain('technical-report-customer');
    expect(reportSectionIds).toContain('maintenance-type');
    expect(reportSectionIds).toContain('visit-observations');
    expect(opinionSectionIds).toContain('technical-opinion-identification');
    expect(opinionSectionIds).toContain('technical-opinion-site-conditions');
    expect(opinionSectionIds).toContain('technical-opinion-conclusion');
    expect(opinionSectionIds).not.toEqual(reportSectionIds);
  });

  it('certifies the DC-03 Technical Opinion structure, signatures and Preview/PDF parity', async () => {
    const context = operationContext(DocumentTemplateType.TECHNICAL_OPINION);
    const operation = context.operation as Record<string, unknown>;
    operation.technicalOpinionObjective =
      'Avaliar tecnicamente os danos térmicos observados nos sistemas de climatização.';
    operation.technicalOpinionObjectiveItems = [
      'Verificar a integridade dos componentes elétricos',
      'Determinar a viabilidade técnica de recuperação',
    ];
    operation.technicalOpinionConditions =
      '- Carcaças com deformação térmica severa\n- Componentes elétricos carbonizados\n- Linhas frigorígenas comprometidas';
    operation.technicalOpinionAnalysis =
      'As evidências visuais demonstram perda de isolamento dielétrico e comprometimento mecânico.\n\nA recuperação não apresenta segurança técnica nem viabilidade econômica.';
    operation.technicalOpinionConclusion =
      'Conclui-se pela substituição integral das unidades afetadas, com descarte ambientalmente adequado.';
    operation.technicalOpinionConclusionItems = [
      'Equipamentos sem condição segura de operação',
      'Substituição integral tecnicamente recomendada',
    ];
    operation.technicalOpinionRecommendations =
      '- Substituição preventiva\n- Monitoramento periódico';
    operation.technicalOpinionResponsible = 'Marina Albuquerque';
    operation.technicalOpinionCrea = 'CREA-PE 123456';
    operation.inspectedEquipments = [
      {
        id: 'inspection-1',
        equipmentId: 'equipment-1',
        position: 0,
        sector: 'Sala 01',
        brandSnapshot: 'Carrier',
        modelSnapshot: 'Split Hi Wall',
        capacitySnapshot: '18.000 BTU/h',
        tagSnapshot: 'EQ-01',
        serialSnapshot: 'SN-001',
        systemTypeSnapshot: 'Unidade Interna e Externa',
        currentSituationSnapshot: 'Unidade externa queimada',
        equipment: { id: 'equipment-1', name: 'Evaporadora 01', type: 'SPLIT' },
      },
      {
        id: 'inspection-2',
        equipmentId: 'equipment-2',
        position: 1,
        sector: 'Auditório',
        brandSnapshot: 'Daikin',
        modelSnapshot: 'Piso Teto',
        capacitySnapshot: '24.000 BTU/h',
        tagSnapshot: 'EQ-02',
        serialSnapshot: 'SN-002',
        systemTypeSnapshot: 'Sistema de expansão direta',
        currentSituationSnapshot: 'Compressor sem funcionamento',
        equipment: { id: 'equipment-2', name: 'Condensadora 02', type: 'CONDENSER' },
      },
    ];
    operation.parts = [
      {
        id: 'part-forbidden',
        quantity: 1,
        notes: null,
        product: { sku: 'SKU-1', name: 'Peça', unit: 'UN' },
        inventoryItem: { location: 'A1' },
      },
    ];
    operation.photos = [
      { id: 'photo-forbidden', caption: 'Não deve aparecer', mimeType: 'image/png', fileSize: 68 },
    ];
    operation.documents = [
      {
        id: 'opinion-document',
        type: DocumentTemplateType.TECHNICAL_OPINION,
        number: 'LDO-000042',
        status: 'DRAFT',
      },
      {
        id: 'work-order-document',
        type: DocumentTemplateType.WORK_ORDER,
        number: 'OS-000042',
        status: 'READY',
      },
    ];
    context.signature = {
      requiresSignature: true,
      signatureMode: 'HYBRID',
      signatureId: 'signature-engineer',
      fixedSignature: null,
      institutionalSignatures: [
        {
          id: 'signature-engineer',
          name: 'Marina Albuquerque',
          title: 'Engenheira Mecânica',
          professionalCouncil: 'CREA-PE 123456',
          department: 'Engenharia',
          image: {
            storageKey: 'signatures/marina.png',
            mimeType: 'image/png',
            fileSize: 68,
            contentBase64: ONE_PIXEL_PNG,
          },
        },
      ],
      collectedSignature: null,
      executionSignatures: [
        {
          role: 'client',
          label: 'Assinatura do cliente/responsável',
          name: 'Carlos Lima',
          title: 'Solicitante',
          signedAt: '2026-07-10T12:00:00.000Z',
          caption: 'Assinatura coletada na execução',
          image: {
            storageKey: 'operations/42/signature.png',
            mimeType: 'image/png',
            fileSize: 68,
            contentBase64: ONE_PIXEL_PNG,
          },
        },
      ],
    };

    const built = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(context);
    const sectionIds = built.sections.map((section) => section.id);
    expect(sectionIds).toEqual([
      'technical-opinion-identification',
      'technical-opinion-requester',
      'technical-opinion-objective',
      'technical-opinion-equipments',
      'technical-opinion-site-conditions',
      'technical-opinion-analysis',
      'technical-opinion-recommendations',
      'technical-opinion-conclusion',
      'photos-evidencias-fotograficas',
      'signature',
    ]);
    expect(sectionIds).not.toEqual(
      expect.arrayContaining([
        'materials-consumed',
        'related-documents',
        'checklist-evidencias-e-verificacoes-consideradas',
      ]),
    );
    const identification = JSON.stringify(
      built.sections.find((section) => section.id === 'technical-opinion-identification'),
    );
    expect(identification).toContain('Marina Albuquerque');
    expect(identification).toContain('CREA-PE 123456');
    expect(identification).toContain('Data da vistoria');
    const requester = JSON.stringify(
      built.sections.find((section) => section.id === 'technical-opinion-requester'),
    );
    expect(requester).toContain('Razão Social');
    expect(requester).toContain('Documento (CNPJ/CPF)');
    expect(requester).toContain('Ana');
    const equipmentTable = built.sections
      .find((section) => section.id === 'technical-opinion-equipments')
      ?.components.find((component) => component.kind === 'table');
    expect(
      equipmentTable?.kind === 'table' ? equipmentTable.columns.map((column) => column.label) : [],
    ).toEqual([
      'Nº',
      'MODELO / CAPACIDADE',
      'TIPO DE SISTEMA',
      'LOCAL DE INSTALAÇÃO',
      'SITUAÇÃO ATUAL',
    ]);
    expect(equipmentTable?.kind === 'table' ? equipmentTable.rows : []).toHaveLength(2);
    expect(JSON.stringify(equipmentTable)).toContain('Unidade externa queimada');
    const objectiveComponents =
      built.sections.find((section) => section.id === 'technical-opinion-objective')?.components ??
      [];
    expect(objectiveComponents.map((component) => component.kind)).toEqual([
      'paragraph',
      'list',
    ]);
    expect(JSON.stringify(objectiveComponents)).toContain(
      'Determinar a viabilidade técnica de recuperação',
    );
    const conclusionComponents =
      built.sections.find((section) => section.id === 'technical-opinion-conclusion')?.components ??
      [];
    expect(conclusionComponents.map((component) => component.kind)).toEqual([
      'paragraph',
      'list',
    ]);
    expect(JSON.stringify(conclusionComponents)).toContain(
      'Substituição integral tecnicamente recomendada',
    );
    const signatures = built.sections
      .find((section) => section.id === 'signature')
      ?.components.find((component) => component.kind === 'signature');
    expect(signatures?.kind === 'signature' ? signatures.signatures : []).toHaveLength(2);
    expect(JSON.stringify(built)).toContain('substituição integral das unidades afetadas');
    expect(JSON.stringify(built)).toContain('Monitoramento periódico');
    expect(
      built.sections
        .flatMap((section) => section.components)
        .some((item) => item.kind === 'qrCode'),
    ).toBe(false);

    const rendered = renderer().render(built);
    const pdf = await new PdfEngineService().create(rendered);
    expect(rendered.blueprint).toBe(built);
    expect(rendered.pages.length).toBeGreaterThanOrEqual(1);
    expect(pdf.pageCount).toBe(rendered.pages.length);
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('certifies DC02B corporate header, maintenance contract and long inspected-equipment pagination', () => {
    const context = operationContext(DocumentTemplateType.TECHNICAL_REPORT);
    const operation = context.operation as Record<string, unknown>;
    operation.referenceMonth = 6;
    operation.referenceYear = 2026;
    operation.maintenanceType = 'SEMIANNUAL';
    operation.maintenanceChecklistItems = [
      {
        id: 'weekly-1',
        maintenanceType: 'WEEKLY',
        description: 'Limpeza de filtro de ar',
        executed: true,
        observations: null,
        position: 0,
      },
      {
        id: 'semiannual-1',
        maintenanceType: 'SEMIANNUAL',
        description: 'Limpeza total dos trocadores de calor',
        executed: true,
        observations: 'Produto não corrosivo',
        position: 0,
      },
    ];
    operation.inspectedEquipments = Array.from({ length: 75 }, (_, index) => ({
      id: `inspection-${index}`,
      equipmentId: `equipment-${index}`,
      position: index,
      sector: `Setor ${index + 1}`,
      brandSnapshot: index % 2 === 0 ? 'Electrolux' : 'TCL',
      modelSnapshot: 'Split',
      capacitySnapshot: `${12 + (index % 3) * 6}.000 BTU`,
      tagSnapshot: `EQ-${index + 1}`,
      serialSnapshot: `SN-${index + 1}`,
      equipment: { id: `equipment-${index}`, name: `Split ${index + 1}`, type: 'SPLIT' },
    }));
    (context.assets as Record<string, unknown>).logo = {
      storageKey: 'organization/logo.png',
      mimeType: 'image/png',
      fileSize: 68,
      contentBase64: ONE_PIXEL_PNG,
    };

    const built = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(context);
    const sectionIds = built.sections.map((section) => section.id);
    expect(sectionIds).toEqual([
      'technical-report-identification',
      'technical-report-customer',
      'technical-report-inspected-equipments',
      'maintenance-type',
      'visit-observations',
    ]);
    expect(sectionIds).not.toContain('technical-report-equipment-qr');
    expect(sectionIds).not.toContain('related-documents');
    expect(sectionIds).not.toContain('maintenance-checklist-weekly');
    const maintenanceColumns = built.sections
      .find((section) => section.id === 'maintenance-type')
      ?.components.find((component) => component.kind === 'checklistColumns');
    expect(maintenanceColumns?.kind).toBe('checklistColumns');
    if (maintenanceColumns?.kind === 'checklistColumns') {
      // Semana e Semestral permanecem em ordem estável; somente o tipo realizado é marcado.
      expect(maintenanceColumns.columns.map((column) => column.title)).toEqual([
        'Semanal',
        'Semestral',
      ]);
      expect(maintenanceColumns.columns.map((column) => column.selected)).toEqual([false, true]);
      expect(maintenanceColumns.columns[0].items[0]).toMatchObject({
        label: 'Limpeza de filtro de ar',
        done: false,
      });
      expect(maintenanceColumns.columns[1].items[0]).toMatchObject({
        label: 'Limpeza total dos trocadores de calor',
        done: true,
      });
    }
    expect(built.header.corporate).toMatchObject({
      legalName: 'ERP Operation LTDA',
      tradeName: 'Orbit',
      cnpj: '00.000.000/0001-00',
      stateRegistration: '0321418-40',
      zipCode: '50000-000',
      phoneNumbers: ['+55 81 99999-9999', '+55 81 98888-7777'],
    });
    const table = built.sections
      .find((section) => section.id === 'technical-report-inspected-equipments')
      ?.components.find((component) => component.kind === 'table');
    expect(
      built.sections.find((section) => section.id === 'technical-report-inspected-equipments')
        ?.title,
    ).toBe('Equipamentos');
    expect(table?.kind === 'table' ? table.columns.map((column) => column.label) : []).toEqual([
      'ITEM',
      'SETOR',
      'MARCA',
      'MODELO',
      'CAPACIDADE',
    ]);
    expect(table?.kind === 'table' ? table.rows : []).toHaveLength(75);
    const rendered = renderer().render(built);
    expect(rendered.pages.length).toBeGreaterThan(3);
    expect(
      rendered.pages
        .flatMap((page) => page.elements)
        .some((element) => element.type === 'text' && element.text.includes('IE 0321418-40')),
    ).toBe(true);
  });

  it.each([
    [DocumentTemplateType.WORK_ORDER, 'work-order-identification'],
    [DocumentTemplateType.TECHNICAL_REPORT, 'visit-observations'],
    [DocumentTemplateType.TECHNICAL_OPINION, 'technical-opinion-site-conditions'],
    [DocumentTemplateType.PMOC, 'pmoc-identification'],
    [DocumentTemplateType.RECEIPT, 'receipt-declaration'],
  ])('builds and renders the official report-center workflow %s', async (type, expectedSection) => {
    const context = operationContext(type);
    const operation = context.operation as Record<string, unknown>;
    operation.reportedIssue = 'Objetivo, diagnóstico ou referência oficial';
    operation.serviceDescription = 'Análise, medição ou valor recebido oficial';
    operation.observations = 'Conclusão e observações persistidas';
    const built = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(context);
    const rendered = renderer().render(built);
    const pdf = await new PdfEngineService().create(rendered);
    expect(built.sections.map((section) => section.id)).toContain(expectedSection);
    expect(built.header.corporate).toMatchObject({
      legalName: 'ERP Operation LTDA',
      tradeName: 'Orbit',
      cnpj: '00.000.000/0001-00',
    });
    expect(rendered.blueprint).toBe(built);
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders the work-order operational status in pt-BR', () => {
    const built = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(operationContext(DocumentTemplateType.WORK_ORDER));
    const identification = built.sections.find(
      (section) => section.id === 'work-order-identification',
    );
    const metadata = identification?.components.find((component) => component.kind === 'metadata');

    expect(metadata?.kind === 'metadata' ? metadata.items : []).toContainEqual({
      label: 'Status',
      value: 'Concluída',
    });

    const technicalReport = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(operationContext(DocumentTemplateType.TECHNICAL_REPORT));
    const reportMetadata = technicalReport.sections
      .find((section) => section.id === 'technical-report-identification')
      ?.components.find((component) => component.kind === 'metadata');
    expect(reportMetadata?.kind === 'metadata' ? reportMetadata.items : []).toContainEqual({
      label: 'Situação',
      value: 'Concluída',
    });
  });

  it('never exposes the operational service value in the document blueprint', () => {
    const context = operationContext(DocumentTemplateType.WORK_ORDER);
    (context.operation as { serviceValue: number }).serviceValue = 987654.32;
    const built = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(context);

    expect(JSON.stringify(built)).not.toContain('987654.32');
    expect(JSON.stringify(built)).not.toContain('serviceValue');
  });

  it('certifies the DC-05 receipt snapshots, technical-only signature and PDF parity', async () => {
    const context = operationContext(DocumentTemplateType.RECEIPT);
    const operation = context.operation as Record<string, unknown>;
    Object.assign(operation, {
      receiptNumber: 'REC-000125',
      receiptIssuedAt: new Date('2026-07-18T00:00:00.000Z'),
      receiptAmount: 1275.9,
      receiptAmountInWords: 'um mil duzentos e setenta e cinco reais e noventa centavos',
      receiptDescription: 'Higienização e revisão do sistema de climatização',
      receiptWarrantyDays: 90,
      receiptDeclaration: 'Declaração administrativa oficial do recibo.',
      photos: [{ id: 'photo-not-allowed', storageKey: 'private/photo.png', caption: 'Não deve aparecer', mimeType: 'image/png', fileSize: 68, createdAt: new Date() }],
    });
    context.signature = {
      requiresSignature: true,
      signatureMode: 'FIXED',
      signatureId: 'technical-signature',
      fixedSignature: null,
      institutionalSignatures: [{ id: 'technical-signature', name: 'Ana Técnica', title: 'Engenheira', professionalCouncil: 'CREA-PE 123', department: 'Engenharia', image: { storageKey: 'private/signature.png', mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG } }],
      collectedSignature: null,
      executionSignatures: [],
    };
    const built = (new DocumentBuilderService({} as never) as unknown as {
      buildFromContext: (ctx: unknown) => DocumentBlueprint;
    }).buildFromContext(context);
    const ids = built.sections.map((section) => section.id);
    expect(built.header.title).toBe('RECIBO / GARANTIA');
    expect(ids).toEqual(['receipt-identification', 'receipt-declaration', 'receipt-warranty', 'signature']);
    expect(ids.some((id) => id.startsWith('photos-'))).toBe(false);
    const signature = built.sections.find((section) => section.id === 'signature')?.components[0];
    expect(signature?.kind === 'signature' ? signature.signatures : []).toHaveLength(1);
    expect(signature?.kind === 'signature' ? signature.signatures[0]?.role : null).toBe('fixed');
    const rendered = renderer().render(built);
    const pdf = await new PdfEngineService().create(rendered);
    expect(rendered.blueprint).toBe(built);
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('uses only the service description in the generated receipt declaration', () => {
    const context = operationContext(DocumentTemplateType.RECEIPT);
    const operation = context.operation as Record<string, unknown>;
    Object.assign(operation, {
      receiptAmount: 850,
      receiptAmountInWords: 'oitocentos e cinquenta reais',
      receiptDescription: 'Higienização e revisão do sistema de climatização',
      receiptWarrantyDays: 90,
      receiptDeclaration: null,
    });

    const built = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(context);
    const declaration = built.sections
      .find((section) => section.id === 'receipt-declaration')
      ?.components.find((component) => component.kind === 'paragraph');
    const text = declaration?.kind === 'paragraph' ? declaration.text : '';

    expect(text).toContain('correspondente aos serviços prestados');
    expect(text).toContain(
      'Descrição dos serviços: Higienização e revisão do sistema de climatização',
    );
    expect(text).not.toContain('Serviço prestado');
  });

  it('distinguishes a product sale receipt and identifies the customer in the fallback declaration', () => {
    const context = operationContext(DocumentTemplateType.RECEIPT);
    const operation = context.operation as Record<string, unknown>;
    Object.assign(operation, {
      sourceSaleId: '8b490e18-72bb-42bd-a51d-fb57457a1a97',
      receiptAmount: 1350,
      receiptAmountInWords: 'mil e trezentos e cinquenta reais',
      receiptDescription: '1 UN — Compressor',
      receiptWarrantyDays: 90,
      receiptDeclaration: null,
    });
    const built = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(context);
    const declaration = built.sections
      .find((section) => section.id === 'receipt-declaration')
      ?.components.find((component) => component.kind === 'paragraph');
    const text = declaration?.kind === 'paragraph' ? declaration.text : '';

    expect(text).toContain('Hospital Santa Clara, CNPJ nº 00.000.000/0001-00');
    expect(text).toContain('correspondente à venda realizada');
    expect(text).toContain('Descrição da venda: 1 UN — Compressor');
    expect(text).not.toContain('venda de produtos: Compressor');
    expect(text).toContain('garantia de 90 dias sobre os produtos fornecidos');
    expect(text).not.toContain('referente ao serviço de');
  });

  it('certifies PMOC equipment checklists, photos and semantic signatures in one Blueprint', async () => {
    const context = operationContext(DocumentTemplateType.PMOC);
    const operation = context.operation as Record<string, unknown>;
    const maintenanceExecution = operation.maintenanceExecution as {
      scheduledAt: Date;
      plan: { pmocPlan: { startDate: Date; endDate: Date } };
    };
    maintenanceExecution.scheduledAt = new Date('2026-07-28T00:00:00.000Z');
    maintenanceExecution.plan.pmocPlan.startDate = new Date('2026-07-28T00:00:00.000Z');
    maintenanceExecution.plan.pmocPlan.endDate = new Date('2027-07-28T00:00:00.000Z');
    operation.maintenanceType = 'MONTHLY';
    operation.inspectedEquipments = [{
      equipmentId: 'equipment-1', position: 0, sector: 'Sala técnica', brandSnapshot: 'Carrier',
      modelSnapshot: 'XPower', capacitySnapshot: '36.000 BTU/h', equipment: { id: 'equipment-1', name: 'Split 01', type: 'SPLIT' },
    }];
    operation.maintenanceChecklistItems = [
      { id: 'check-1', equipmentId: null, pmocUnit: 'EVAPORATOR', maintenanceType: 'MONTHLY', description: 'Limpar filtros de ar', executed: true, result: 'YES', observations: 'Sem avarias', position: 0, equipment: null },
      { id: 'check-2', equipmentId: null, pmocUnit: 'EVAPORATOR', maintenanceType: 'MONTHLY', description: 'Verificar dreno', executed: false, result: 'NOT_APPLICABLE', observations: null, position: 1, equipment: null },
    ];
    context.signature = {
      requiresSignature: true,
      signatureMode: 'HYBRID',
      signatureId: 'institutional',
      fixedSignature: null,
      institutionalSignatures: [{ id: 'institutional', name: 'Marina', title: 'Engenheira', professionalCouncil: 'CREA-123', department: 'Técnico', image: { storageKey: 'private', mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG } }],
      collectedSignature: { label: 'Cliente', name: 'Ana', title: 'Gestora', signedAt: new Date().toISOString(), caption: 'Assinatura coletada', image: { storageKey: 'private-client', mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG } },
      executionSignatures: [{ role: 'client', label: 'Assinatura do cliente/responsável', name: 'Ana', title: 'Gestora', signedAt: new Date().toISOString(), caption: 'Assinatura coletada', image: { storageKey: 'private-client', mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG } }],
    };
    const built = (new DocumentBuilderService({} as never) as unknown as { buildFromContext: (ctx: unknown) => DocumentBlueprint }).buildFromContext(context);
    const ids = built.sections.map((section) => section.id);
    expect(ids).toEqual(expect.arrayContaining(['pmoc-identification', 'pmoc-operational-data', 'pmoc-inspected-equipments', 'pmoc-legal-reference', 'pmoc-checklist', 'signature']));
    const operational = built.sections.find((section) => section.id === 'pmoc-operational-data')?.components[0];
    const operationalItems = operational?.kind === 'metadata' ? operational.items : [];
    expect(operationalItems.find((item) => item.label === 'Execução prevista')?.value).toBe('28/07/2026');
    expect(operationalItems.find((item) => item.label === 'Vigência')?.value).toBe('28/07/2026 a 28/07/2027');
    const checklistSection = built.sections.find((section) => section.id === 'pmoc-checklist');
    const table = checklistSection?.components.find((component) => component.kind === 'table');
    expect(table?.kind === 'table' ? table.rows.map((row) => row.executed) : []).toEqual(['Sim', 'N.A.']);
    const signatures = built.sections.find((section) => section.id === 'signature')?.components[0];
    expect(signatures?.kind === 'signature' ? signatures.signatures : []).toHaveLength(2);
    const rendered = renderer().render(built);
    const pdf = await new PdfEngineService().create(rendered);
    expect(rendered.blueprint).toBe(built);
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('marks an unsigned HYBRID PMOC explicitly and keeps four-column image parity', () => {
    const context = operationContext(DocumentTemplateType.PMOC);
    const operation = context.operation as Record<string, unknown>;
    operation.photos = [1, 2, 3, 4].map((index) => ({
      id: `pmoc-photo-${index}`,
      storageKey: `operations/pmoc/photo-${index}.png`,
      caption: `Evidência ${index}`,
      mimeType: 'image/png',
      fileSize: 68,
      createdAt: new Date(),
    }));
    (context.assets as { images: Array<{ storageKey: string; mimeType: string; fileSize: number; contentBase64: string }> }).images = [1, 2, 3, 4].map((index) => ({
      storageKey: `operations/pmoc/photo-${index}.png`,
      mimeType: 'image/png',
      fileSize: 68,
      contentBase64: ONE_PIXEL_PNG,
    }));
    context.signature = {
      requiresSignature: true,
      signatureMode: 'HYBRID',
      signatureId: 'institutional',
      fixedSignature: null,
      institutionalSignatures: [{ id: 'institutional', name: 'Marina', title: 'Engenheira', professionalCouncil: 'CREA-123', department: 'Técnico', image: { storageKey: 'private', mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG } }],
      collectedSignature: { label: 'Cliente', name: null, title: null, signedAt: null, caption: 'Pendente', image: null },
      executionSignatures: [{ role: 'client', label: 'Assinatura do cliente/responsável', name: null, title: null, signedAt: null, caption: 'Pendente', image: null }],
    };

    const builder = new DocumentBuilderService({} as never) as unknown as { buildFromContext: (ctx: unknown) => DocumentBlueprint };
    const unsigned = builder.buildFromContext(context);
    const identification = unsigned.sections.find((section) => section.id === 'pmoc-identification')?.components[0];
    const gallery = unsigned.sections.find((section) => section.id === 'photos-evidencias-fotograficas')?.components[0];
    // "Situação" foi removido da identificação; o estado não assinado continua
    // sinalizado pela seção dedicada abaixo.
    expect(identification?.kind === 'metadata' ? identification.items.find((item) => item.label === 'Situação') : undefined).toBeUndefined();
    expect(unsigned.sections.map((section) => section.id)).toContain('pmoc-signature-pending');
    expect(gallery?.kind === 'imageGallery' ? gallery.columns : null).toBe(4);
    expect(gallery?.kind === 'imageGallery' ? gallery.images : []).toHaveLength(4);

    operation.signatureData = `data:image/png;base64,${ONE_PIXEL_PNG}`;
    const signed = builder.buildFromContext(context);
    expect(signed.sections.map((section) => section.id)).not.toContain('pmoc-signature-pending');
    const signedIdentification = signed.sections.find((section) => section.id === 'pmoc-identification')?.components[0];
    // "Situação" não aparece mais na identificação, mesmo após assinar.
    expect(signedIdentification?.kind === 'metadata' ? signedIdentification.items.find((item) => item.label === 'Situação') : undefined).toBeUndefined();
  });

  it('certifies the Technical Visit Report structure and Preview/PDF blueprint parity', async () => {
    const context = operationContext(DocumentTemplateType.TECHNICAL_REPORT);
    const operation = context.operation as Record<string, unknown>;
    operation.rvtExecution = { id: 'rvt-execution-7', executionNumber: 7 };
    operation.reportedIssue = 'Avaliar a perda de rendimento térmico relatada pelo cliente.';
    operation.technicalDiagnosis =
      'Foi identificada obstrução parcial do filtro.\n- Pressão dentro da faixa operacional\n- Dreno com escoamento reduzido';
    operation.serviceDescription =
      'Limpeza técnica do conjunto filtrante.\nHigienização da bandeja e desobstrução do dreno.';
    operation.technicalRecommendations =
      '- Repetir inspeção em 30 dias\n- Monitorar corrente do compressor';
    operation.observations = 'Equipamento liberado em operação, sem ruído anormal após os testes.';
    operation.parts = [
      {
        id: 'part-1',
        quantity: 1,
        notes: 'Substituído em campo',
        product: {
          id: 'product-1',
          sku: 'FLT-001',
          name: 'Filtro lavável',
          unit: 'UN',
          brand: 'Orbit',
          model: 'F1',
          category: 'Filtro',
        },
        inventoryItem: { id: 'inventory-1', location: 'Almoxarifado principal' },
      },
    ];
    operation.photos = [
      {
        id: 'photo-1',
        storageKey: 'operations/report/photo.png',
        caption: 'Evaporadora após higienização',
        mimeType: 'image/png',
        fileSize: 68,
        createdAt: new Date('2026-07-13T12:00:00.000Z'),
      },
    ];
    (context.assets as { images: unknown[] }).images = [
      {
        storageKey: 'operations/report/photo.png',
        mimeType: 'image/png',
        fileSize: 68,
        contentBase64: ONE_PIXEL_PNG,
      },
    ];
    context.signature = {
      requiresSignature: true,
      signatureMode: 'HYBRID',
      signatureId: 'signature-1',
      fixedSignature: null,
      institutionalSignatures: [
        {
          id: 'signature-1',
          name: 'Responsável Técnica',
          title: 'Engenheira Mecânica',
          professionalCouncil: 'CREA-PE 123456',
          department: 'Engenharia',
          image: {
            storageKey: 'signatures/technical.png',
            mimeType: 'image/png',
            fileSize: 68,
            contentBase64: ONE_PIXEL_PNG,
          },
        },
      ],
      collectedSignature: null,
      executionSignatures: [
        {
          role: 'client',
          label: 'Assinatura do cliente',
          name: 'Responsável local',
          title: null,
          signedAt: '2026-07-13T12:00:00.000Z',
          caption: 'Coletada durante a visita',
          image: {
            storageKey: 'operations/report/client.png',
            mimeType: 'image/png',
            fileSize: 68,
            contentBase64: ONE_PIXEL_PNG,
          },
        },
      ],
    };

    const built = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(context);
    const ids = built.sections.map((section) => section.id);
    expect(ids).toEqual([
      'technical-report-identification',
      'technical-report-customer',
      'technical-report-inspected-equipments',
      'maintenance-type',
      'visit-observations',
      'visit-recommendations',
      'photos-evidencias-fotograficas',
      'signature',
    ]);
    const identification = built.sections.find(
      (section) => section.id === 'technical-report-identification',
    );
    const identificationMetadata = identification?.components.find(
      (component) => component.kind === 'metadata',
    );
    expect(built.header.documentNumber).toBe('RVT-000042');
    expect(identificationMetadata?.kind === 'metadata' ? identificationMetadata.items : []).toContainEqual({
      label: 'Número',
      value: '007',
    });
    expect(
      identification?.components.some(
        (component) =>
          component.kind === 'metadata' &&
          component.items.some((item) => item.label === 'Técnico em campo'),
      ),
    ).toBe(true);
    const signature = built.sections.at(-1)?.components[0];
    expect(signature?.kind === 'signature' ? signature.signatures : []).toHaveLength(2);
    const rendered = renderer().render(built);
    const pdf = await new PdfEngineService().create(rendered);
    expect(rendered.blueprint).toBe(built);
    expect(
      rendered.pages
        .flatMap((page) => page.elements)
        .some((element) => element.type === 'text' && element.text.includes('Equipamento liberado')),
    ).toBe(true);
    expect(
      rendered.pages.flatMap((page) => page.elements).filter((element) => element.type === 'image'),
    ).toHaveLength(3);
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.pageCount).toBe(rendered.pages.length);
  });

  it.each([
    ['NONE', 0],
    ['FIXED', 1],
    ['COLLECTED', 1],
    ['HYBRID', 2],
  ] as const)(
    'applies TECHNICAL_REPORT signature policy %s without automatic selection',
    (mode, expectedCount) => {
      const context = operationContext(DocumentTemplateType.TECHNICAL_REPORT);
      const institutional = {
        id: 'signature-fixed',
        name: 'Responsável Técnica',
        title: 'Engenheira Mecânica',
        professionalCouncil: 'CREA-PE 123456',
        department: 'Engenharia',
        image: {
          storageKey: 'signatures/fixed.png',
          mimeType: 'image/png',
          fileSize: 68,
          contentBase64: ONE_PIXEL_PNG,
        },
      };
      const collected = {
        role: 'client' as const,
        label: 'Assinatura do cliente',
        name: 'Responsável local',
        title: null,
        signedAt: '2026-07-13T12:00:00.000Z',
        caption: 'Coletada na execução',
        image: {
          storageKey: 'operations/report/client.png',
          mimeType: 'image/png',
          fileSize: 68,
          contentBase64: ONE_PIXEL_PNG,
        },
      };
      context.signature = {
        requiresSignature: mode !== 'NONE',
        signatureMode: mode,
        signatureId: mode === 'FIXED' || mode === 'HYBRID' ? institutional.id : null,
        fixedSignature: null,
        institutionalSignatures: mode === 'FIXED' || mode === 'HYBRID' ? [institutional] : [],
        collectedSignature: null,
        executionSignatures: mode === 'COLLECTED' || mode === 'HYBRID' ? [collected] : [],
      };
      const built = (
        new DocumentBuilderService({} as never) as unknown as {
          buildFromContext: (ctx: unknown) => DocumentBlueprint;
        }
      ).buildFromContext(context);
      const signature = built.sections
        .flatMap((section) => section.components)
        .find((component) => component.kind === 'signature');
      expect(signature?.kind === 'signature' ? signature.signatures.length : 0).toBe(expectedCount);
      if (signature?.kind === 'signature') expect(signature.mode).toBe(mode);
    },
  );

  it('certifies Work Order semantic order and keeps the same Blueprint for preview and PDF render', async () => {
    const context = operationContext(DocumentTemplateType.WORK_ORDER);
    const operation = context.operation as Record<string, unknown>;
    operation.reportedIssue = 'Cliente relata temperatura elevada — equipamento sem rendimento.';
    operation.serviceDescription =
      'Inspeção técnica completa\n- Correção do vazamento\nRecarga de fluido refrigerante';
    operation.inspectedEquipments = [
      {
        equipmentId: 'equipment-1',
        sector: 'Recepção',
        brandSnapshot: 'York',
        modelSnapshot: 'YCAL',
        capacitySnapshot: '60 TR',
      },
      {
        equipmentId: 'equipment-2',
        sector: 'Centro cirúrgico',
        brandSnapshot: 'Carrier',
        modelSnapshot: 'AquaSnap',
        capacitySnapshot: '40 TR',
      },
    ];
    operation.photos = [1, 2, 3].map((index) => ({
      id: `photo-${index}`,
      storageKey: `operations/42/photo-${index}.png`,
      caption: `Evidência ${index}`,
      mimeType: 'image/png',
      fileSize: 68,
    }));
    operation.documents = [
      {
        id: 'related-report',
        type: DocumentTemplateType.REPORT,
        number: 'REL-000001',
        status: 'READY',
      },
    ];
    (context.assets as Record<string, unknown>).logo = {
      storageKey: 'organization/logo.png',
      mimeType: 'image/png',
      fileSize: 68,
      contentBase64: ONE_PIXEL_PNG,
    };
    (context.assets as Record<string, unknown>).images = [1, 2, 3].map((index) => ({
      storageKey: `operations/42/photo-${index}.png`,
      mimeType: 'image/png',
      fileSize: 68,
      contentBase64: ONE_PIXEL_PNG,
    }));
    const builder = new DocumentBuilderService({} as never);
    const workOrder = (
      builder as unknown as { buildFromContext: (ctx: unknown) => DocumentBlueprint }
    ).buildFromContext(context);
    const ids = workOrder.sections.map((section) => section.id);
    expect(ids).toEqual([
      'work-order-identification',
      'work-order-customer',
      'work-order-inspected-equipments',
      'work-order-reported-issue',
      'work-order-execution',
      'observations-observacoes-e-resultado-operacional',
      'photos-evidencias-fotograficas',
    ]);
    expect(ids).not.toContain('related-documents');
    const equipmentComponents =
      workOrder.sections.find((section) => section.id === 'work-order-inspected-equipments')
        ?.components ?? [];
    expect(equipmentComponents.map((component) => component.kind)).toEqual(['table']);
    const equipmentTable = equipmentComponents.find((component) => component.kind === 'table');
    expect(equipmentTable?.kind === 'table' ? equipmentTable.rows : []).toHaveLength(2);
    const execution = workOrder.sections.find((section) => section.id === 'work-order-execution');
    expect(execution?.title).toBe('Serviços executados / Checklist da execução');
    expect(execution?.components.map((component) => component.kind)).toEqual(['list', 'checklist']);
    const gallery = workOrder.sections
      .find((section) => section.id === 'photos-evidencias-fotograficas')
      ?.components.find((component) => component.kind === 'imageGallery');
    expect(gallery?.kind === 'imageGallery' ? gallery.images : []).toHaveLength(3);
    expect(gallery?.kind === 'imageGallery' ? gallery.columns : null).toBe(2);
    expect(workOrder.footer.content).not.toContain('Blueprint');
    const rendered = renderer().render(workOrder);
    const pdf = await new PdfEngineService().create(rendered);
    expect(rendered.blueprint).toBe(workOrder);
    expect(rendered.pages[0]?.elements.some((element) => element.type === 'image')).toBe(true);
    expect(
      workOrder.sections
        .flatMap((section) => section.components)
        .some((component) => component.kind === 'qrCode'),
    ).toBe(false);
    const headerLogo = rendered.pages[0]?.elements.find(
      (element) => element.type === 'image' && element.width === 100 && element.height === 32,
    );
    expect(headerLogo?.type === 'image' ? headerLogo.y : null).toBeCloseTo(
      DOCUMENT_PAGE.height - 8 - 30 - 32,
      1,
    );
    const headerTitle = rendered.pages[0]?.elements.find(
      (element) => element.type === 'text' && element.text === 'Ordem de Serviço',
    );
    const headerCompany = rendered.pages[0]?.elements.find(
      (element) => element.type === 'text' && element.text === 'Orbit',
    );
    expect(
      headerTitle?.type === 'text' ? DOCUMENT_PAGE.height - headerTitle.y - headerTitle.size : null,
    ).toBeCloseTo(
      headerCompany?.type === 'text'
        ? DOCUMENT_PAGE.height - headerCompany.y - headerCompany.size
        : 0,
      1,
    );
    const checklistPage = rendered.pages.find((page) =>
      page.elements.some(
        (element) =>
          element.type === 'text' && element.text === 'Serviços executados / Checklist da execução',
      ),
    );
    expect(
      checklistPage?.elements.some(
        (element) => element.type === 'text' && element.text.includes('Inspeção visual'),
      ),
    ).toBe(true);
    expect(
      checklistPage?.elements.filter(
        (element) => element.type === 'line' && element.color === '#0f766e',
      ),
    ).toHaveLength(4);
    const galleryImages = rendered.pages
      .flatMap((page) => page.elements)
      .filter(
        (element): element is RenderedImage =>
          element.type === 'image' &&
          element.contentBase64 === ONE_PIXEL_PNG &&
          element.height === 92,
      );
    expect(galleryImages).toHaveLength(3);
    expect(galleryImages[0]?.y).toBe(galleryImages[1]?.y);
    expect((galleryImages[0]?.x ?? 0) < (galleryImages[1]?.x ?? 0)).toBe(true);
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(JSON.stringify(workOrder)).toContain('temperatura elevada — equipamento');
  });

  it('omits the Work Order photographic evidence section when no photos exist', () => {
    const context = operationContext(DocumentTemplateType.WORK_ORDER);
    const workOrder = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(context);

    expect(workOrder.sections.map((section) => section.id)).not.toContain(
      'photos-evidencias-fotograficas',
    );
  });

  it('keeps NONE authoritative even when legacy execution signature data exists', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const operation = (
      operationContext(DocumentTemplateType.WORK_ORDER) as unknown as {
        operation: Record<string, unknown>;
      }
    ).operation;
    operation.signatureData = `data:image/png;base64,${ONE_PIXEL_PNG}`;
    operation.signedAt = now;
    operation.documents = [];

    const context = new DocumentContextService(
      {
        operation: {
          findUnique: jest.fn().mockResolvedValue(operation),
        },
        brandAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never,
      {
        getConfigurationForType: jest.fn().mockResolvedValue({
          type: DocumentTemplateType.WORK_ORDER,
          organization: {
            legalName: 'ERP Operation LTDA',
            tradeName: 'Orbit',
            cnpj: '00.000.000/0001-00',
            email: 'contato@orbit.local',
            phone: '+55 81 99999-9999',
            city: 'Recife',
            state: 'PE',
            primaryColor: '#111827',
            secondaryColor: '#2563EB',
          },
          settings: { timezone: 'America/Recife', currency: 'BRL' },
          defaultTemplate: {
            id: 'template-work-order',
            organizationId: 'organization-id',
            type: DocumentTemplateType.WORK_ORDER,
            name: 'OS padrão',
            headerContent: '',
            footerContent: '',
            observations: '',
            isDefault: true,
            isSystem: true,
            isActive: true,
            requiresSignature: false,
            signatureMode: 'NONE',
            signatureId: null,
            createdAt: now,
            updatedAt: now,
            signature: null,
          },
        }),
      } as never,
      {
        generateQrCode: jest.fn().mockResolvedValue({
          storageKey: 'generated:qr',
          mimeType: 'image/png',
          fileSize: 68,
          contentBase64: ONE_PIXEL_PNG,
        }),
      } as never,
    );

    const created = await context.create('operation-id', DocumentTemplateType.WORK_ORDER);
    const builder = new DocumentBuilderService({} as never);
    const blueprint = (
      builder as unknown as { buildFromContext: (ctx: unknown) => DocumentBlueprint }
    ).buildFromContext(created);
    const signature = blueprint.sections
      .flatMap((section) => section.components)
      .find((component) => component.kind === 'signature');

    expect(created.signature.requiresSignature).toBe(false);
    expect(created.signature.signatureMode).toBe('NONE');
    expect(created.signature.collectedSignature).toBeNull();
    expect(created.signature.executionSignatures).toEqual([]);
    expect(signature).toBeUndefined();
  });

  it('resolves the exact institutional signature configured by the WORK_ORDER template', async () => {
    const base = operationContext(DocumentTemplateType.WORK_ORDER);
    const operation = base.operation as Record<string, unknown>;
    operation.signatureData = `data:image/png;base64,${ONE_PIXEL_PNG}`;
    operation.signedAt = new Date();
    const institutional = {
      id: '7db71471-0cf4-4414-8d06-83eb9c1917c1',
      name: 'Responsável Técnica',
      title: 'Engenheira Mecânica',
      professionalCouncil: 'CREA-PE 123',
      department: 'Engenharia',
      imageStorageKey: 'signatures/technical.png',
      mimeType: 'image/png',
      fileSize: 68,
      active: true,
      deletedAt: null,
    };
    const configuration = {
      ...base.configuration,
      defaultTemplate: {
        id: 'template',
        organizationId: 'organization',
        type: 'WORK_ORDER',
        name: 'OS',
        headerContent: '',
        footerContent: '',
        observations: '',
        isDefault: true,
        isSystem: true,
        isActive: true,
        requiresSignature: true,
        signatureMode: 'FIXED',
        signatureId: institutional.id,
        executionSignatureClient: true,
        executionSignatureTechnician: true,
        executionSignatureOperator: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        signature: institutional,
        institutionalSignatures: [{ position: 0, signature: institutional }],
      },
    };
    const context = new DocumentContextService(
      {
        operation: { findUnique: jest.fn().mockResolvedValue(operation) },
        brandAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never,
      { getConfigurationForType: jest.fn().mockResolvedValue(configuration) } as never,
      {
        generateQrCode: jest.fn().mockResolvedValue((base.assets as { qrCode: unknown }).qrCode),
        resolveSignature: jest.fn().mockResolvedValue({
          storageKey: institutional.imageStorageKey,
          mimeType: 'image/png',
          fileSize: 68,
          contentBase64: ONE_PIXEL_PNG,
        }),
      } as never,
    );
    const created = await context.create('operation', DocumentTemplateType.WORK_ORDER);
    const built = (
      new DocumentBuilderService({} as never) as unknown as {
        buildFromContext: (ctx: unknown) => DocumentBlueprint;
      }
    ).buildFromContext(created);
    const component = built.sections
      .flatMap((section) => section.components)
      .find((item) => item.kind === 'signature');
    expect(created.signature.institutionalSignatures[0]?.id).toBe(institutional.id);
    expect(created.signature.executionSignatures).toHaveLength(0);
    expect(component && 'signatures' in component ? component.signatures[0] : null).toMatchObject({
      id: institutional.id,
      label: 'Responsável técnico',
      name: institutional.name,
    });
    expect(component && 'signatures' in component ? component.signatures : []).toHaveLength(1);
  });

  it('uses a PMOC institutional override without mutating or selecting another template signature', async () => {
    const templateSignature = {
      id: '7db71471-0cf4-4414-8d06-83eb9c1917c1', name: 'Assinatura do modelo', title: 'Diretoria',
      professionalCouncil: null, department: 'Diretoria', imageStorageKey: 'signatures/template.png',
      mimeType: 'image/png', fileSize: 68, active: true, deletedAt: null,
    };
    const override = {
      id: '7db71471-0cf4-4414-8d06-83eb9c1917c2', name: 'Responsável do PMOC', title: 'Engenheira Mecânica',
      professionalCouncil: 'CREA-PE 456', department: 'Engenharia', imageStorageKey: 'signatures/pmoc.png',
      mimeType: 'image/png', fileSize: 68, active: true, deletedAt: null,
    };
    const service = new DocumentContextService(
      {} as never,
      {} as never,
      { resolveSignature: jest.fn().mockResolvedValue({ storageKey: override.imageStorageKey, mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG }) } as never,
    );
    const result = await (service as unknown as {
      resolveSignature: (template: unknown, operation: null, institutionalOverride: unknown) => Promise<{ signatureId: string | null; institutionalSignatures: Array<{ id: string; name: string }> }>;
    }).resolveSignature({
      requiresSignature: true,
      signatureMode: 'FIXED',
      signature: templateSignature,
      institutionalSignatures: [{ position: 0, signature: templateSignature }],
      executionSignatureClient: false,
      executionSignatureTechnician: false,
      executionSignatureOperator: false,
    }, null, override);

    expect(result.signatureId).toBe(override.id);
    expect(result.institutionalSignatures).toEqual([
      expect.objectContaining({ id: override.id, name: override.name }),
    ]);
  });

  it('hydrates persisted operation photos into image blueprint components', async () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const operation = (
      operationContext(DocumentTemplateType.TECHNICAL_REPORT) as unknown as {
        operation: Record<string, unknown>;
      }
    ).operation;
    operation.photos = [
      {
        id: 'photo-id',
        operationId: operation.id,
        storageKey: 'operations/op/photos/photo.png',
        caption: 'Condensadora antes da manutenção',
        mimeType: 'image/png',
        fileSize: Buffer.from(ONE_PIXEL_PNG, 'base64').length,
        createdAt: now,
      },
    ];
    operation.documents = [];
    const generateQrCode = jest.fn().mockResolvedValue({
      storageKey: 'generated:qr',
      mimeType: 'image/png',
      fileSize: 68,
      contentBase64: ONE_PIXEL_PNG,
    });

    const context = new DocumentContextService(
      {
        operation: {
          findUnique: jest.fn().mockResolvedValue(operation),
        },
        brandAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      } as never,
      {
        getConfigurationForType: jest.fn().mockResolvedValue({
          type: DocumentTemplateType.WORK_ORDER,
          organization: {
            legalName: 'ERP Operation LTDA',
            tradeName: 'Orbit',
            cnpj: '00.000.000/0001-00',
            email: 'contato@orbit.local',
            phone: '+55 81 99999-9999',
            city: 'Recife',
            state: 'PE',
            primaryColor: '#111827',
            secondaryColor: '#2563EB',
          },
          settings: { timezone: 'America/Recife', currency: 'BRL' },
          defaultTemplate: null,
        }),
      } as never,
      {
        resolveDocumentImage: jest.fn().mockResolvedValue({
          storageKey: 'operations/op/photos/photo.png',
          mimeType: 'image/png',
          fileSize: Buffer.from(ONE_PIXEL_PNG, 'base64').length,
          contentBase64: ONE_PIXEL_PNG,
        }),
        generateQrCode,
      } as never,
    );

    const created = await context.create('operation-id', DocumentTemplateType.WORK_ORDER);
    const builder = new DocumentBuilderService({} as never);
    const blueprint = (
      builder as unknown as { buildFromContext: (ctx: unknown) => DocumentBlueprint }
    ).buildFromContext(created);
    const gallery = blueprint.sections
      .flatMap((section) => section.components)
      .find((component) => component.kind === 'imageGallery');

    expect(created.assets.images[0]?.contentBase64).toBe(ONE_PIXEL_PNG);
    expect(created.assets.qrCode).toBeNull();
    expect(generateQrCode).not.toHaveBeenCalled();
    expect(gallery).toBeDefined();
    expect(gallery?.kind === 'imageGallery' ? gallery.images[0]?.image?.contentBase64 : null).toBe(
      ONE_PIXEL_PNG,
    );
  });

  it('rejects invalid collected signature payloads before persistence', () => {
    const service = new OperationsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    {} as never,
    );
    const normalize = (
      service as unknown as { normalizeSignatureData: (value?: string) => string | null }
    ).normalizeSignatureData.bind(service);

    expect(() =>
      normalize(`data:image/png;base64,${Buffer.from('bad').toString('base64')}`),
    ).toThrow('Signature binary is invalid');
  });

  it('waits for signature/photo persistence and returns the authoritative Operation after update', async () => {
    const operation = {
      id: '7db71471-0cf4-4414-8d06-83eb9c1917c9',
      signatureData: null,
      signedAt: null,
      photos: [],
      _count: { photos: 0 },
    };
    const transactionOperationUpdate = jest.fn().mockResolvedValue(operation);
    const operationFindUnique = jest.fn().mockResolvedValue(operation);
    const photoCreate = jest.fn().mockResolvedValue({ id: 'photo-id' });
    const prisma = {
      operation: { findUnique: operationFindUnique },
      operationPhoto: { create: photoCreate },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<void>) =>
        callback({
          operation: { update: transactionOperationUpdate },
          operationDocument: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
          documentRevision: { create: jest.fn() },
          auditLog: { create: jest.fn() },
        }),
      ),
    };
    const storageSave = jest.fn().mockResolvedValue(undefined);
    const service = new OperationsService(
      prisma as never,
      { save: storageSave, delete: jest.fn() } as never,
      { publishOperationCompletedTx: jest.fn() } as never,
      { syncOperationCompletedTx: jest.fn() } as never,
      {} as never,
      {} as never,
      {
        assertOperationAccess: jest.fn(),
        assertOperationBackedResourceAccess: jest.fn(),
      } as never,
      {} as never,
    );

    const result = await service.update(
      operation.id,
      {
        signatureData: `data:image/png;base64,${ONE_PIXEL_PNG}`,
        signedAt: '2026-07-11T10:00:00.000Z',
        photos: [{ dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG}`, caption: 'Evidência' }],
      },
      { id: 'actor-id', role: Role.OWNER } as never,
      { requestId: 'request-id', ip: null, userAgent: null },
    );

    expect(transactionOperationUpdate).toHaveBeenCalled();
    expect(storageSave).toHaveBeenCalled();
    expect(photoCreate).toHaveBeenCalled();
    expect(operationFindUnique).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      id: operation.id,
      _count: operation._count,
      photos: operation.photos,
      signedAt: operation.signedAt,
      signatureCaptured: false,
    });
    expect(result).not.toHaveProperty('signatureData');
  });

  it('detects a previously rendered Work Order as stale after its signature changes', async () => {
    const current = blueprint(1);
    current.sections.push({
      id: 'signature',
      title: 'Assinatura',
      critical: true,
      components: [
        {
          id: 'execution-signature',
          kind: 'signature',
          mode: 'COLLECTED',
          signatures: [
            {
              id: 'collected',
              role: 'collected',
              label: 'Assinatura do cliente',
              name: null,
              title: null,
              signedAt: '2026-07-11T10:00:00.000Z',
              caption: 'Assinatura coletada na execução',
              image: { mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG },
            },
          ],
        },
      ],
    });
    const document = {
      id: 'f50e8e28-0ee0-4cd1-b9e3-3f22f1d744f5',
      operationId: current.metadata.operationId,
      budgetId: null,
      type: DocumentTemplateType.WORK_ORDER,
      number: 'OS-000001',
      status: 'READY',
      storageKey: 'documents/old.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      renderedAt: new Date('2026-07-11T09:00:00.000Z'),
      renderMetadata: { sourceFingerprint: 'a'.repeat(64) },
      createdAt: new Date('2026-07-11T09:00:00.000Z'),
      updatedAt: new Date('2026-07-11T09:00:00.000Z'),
    };
    const getDocumentPdf = jest.fn();
    const service = new DocumentEngineService(
      { operationDocument: { findUnique: jest.fn().mockResolvedValue(document) } } as never,
      { buildFromOperation: jest.fn().mockResolvedValue(current) } as never,
      {} as never,
      {} as never,
      {} as never,
      { getDocumentPdf } as never,
      {} as never,
      {
        assertOperationAccess: jest.fn(),
        assertOperationBackedResourceAccess: jest.fn(),
      } as never,
    );

    await expect(
      service.downloadDocument(document.id, { id: 'actor-id', role: Role.OWNER } as never, {
        requestId: 'request-id',
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_STALE' });
    expect(getDocumentPdf).not.toHaveBeenCalled();
  });

  it('keeps source fingerprints stable across preview timestamps and changes them for semantic content', () => {
    const service = new DocumentEngineService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const fingerprint = (value: DocumentBlueprint): string | undefined =>
      (
        service as unknown as {
          withSourceFingerprint: (blueprint: DocumentBlueprint) => DocumentBlueprint;
        }
      ).withSourceFingerprint(value).metadata.sourceFingerprint;
    const first = blueprint(1);
    first.footer.content = 'Emissão 29/06/2026, 07:00';
    const firstMetadata = first.sections[0]?.components[0];
    if (firstMetadata?.kind === 'metadata')
      firstMetadata.items.push({ label: 'Emissão', value: '29/06/2026, 07:00' });
    const regenerated = structuredClone(first);
    regenerated.metadata.generatedAt = '2026-07-11T12:00:00.000Z';
    regenerated.footer.generatedAt = '2026-07-11T12:00:00.000Z';
    regenerated.footer.content = 'Emissão 11/07/2026, 09:00';
    const regeneratedMetadata = regenerated.sections[0]?.components[0];
    if (regeneratedMetadata?.kind === 'metadata' && regeneratedMetadata.items.at(-1))
      regeneratedMetadata.items.at(-1)!.value = '11/07/2026, 09:00';
    const changed = structuredClone(first);
    const metadata = changed.sections[0]?.components[0];
    if (metadata?.kind === 'metadata' && metadata.items[0])
      metadata.items[0].value = 'Outro cliente';

    expect(fingerprint(first)).toBe(fingerprint(regenerated));
    expect(fingerprint(changed)).not.toBe(fingerprint(first));
  });

  it('lists the official repository with server-side filters and pagination', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const findMany = jest.fn();
    const count = jest.fn();
    const prisma = {
      operationDocument: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([
        [
          {
            id: 'doc',
            number: 'OS-1',
            type: 'WORK_ORDER',
            status: 'READY',
            budgetId: null,
            operationId: 'op',
            renderedAt: now,
            createdAt: now,
            updatedAt: now,
            fileSize: 100,
            renderMetadata: { blueprintVersion: '1.0' },
            budget: null,
            operation: {
              id: 'op',
              number: 1,
              customer: { id: 'c', name: 'Cliente' },
              equipment: { id: 'e', name: 'Equipamento', tag: 'EQ' },
              operator: { id: 'u', name: 'Operador' },
            },
          },
        ],
        1,
      ]),
    };
    const service = new DocumentEngineService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { documentScope: jest.fn().mockReturnValue({}) } as never,
    );
    const result = (await service.listDocuments(
      { page: 1, limit: 20, search: 'OS', customerId: '00000000-0000-4000-8000-000000000001' },
      { id: 'owner', role: Role.OWNER } as never,
    )) as { items: Array<{ number: string; origin: string }>; pagination: { total: number } };
    expect(result.items[0]).toMatchObject({ number: 'OS-1', origin: 'OPERATION' });
    expect(result.pagination.total).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('certifies DC-06 services, materials, commercial terms, signatures and PDF parity', async () => {
    const base = operationContext(DocumentTemplateType.BUDGET);
    const now = new Date('2026-07-18T12:00:00.000Z');
    const context = {
      kind: 'budget',
      configuration: base.configuration,
      template: null,
      signature: {
        requiresSignature: true,
        signatureMode: 'HYBRID',
        signatureId: 'technical-signature',
        fixedSignature: null,
        institutionalSignatures: [{ id: 'technical-signature', name: 'Ana Técnica', title: 'Engenheira', professionalCouncil: 'CREA-PE 123', department: 'Engenharia', image: { storageKey: 'private/technical.png', mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG } }],
        collectedSignature: { label: 'Assinatura do cliente/responsável', name: 'Carlos Cliente', title: 'Responsável', signedAt: now.toISOString(), caption: 'Assinatura do cliente', image: { storageKey: 'private/customer.png', mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG } },
        executionSignatures: [{ role: 'client', label: 'Assinatura do cliente/responsável', name: 'Carlos Cliente', title: 'Responsável', signedAt: now.toISOString(), caption: 'Assinatura do cliente', image: { storageKey: 'private/customer.png', mimeType: 'image/png', fileSize: 68, contentBase64: ONE_PIXEL_PNG } }],
      },
      assets: { signature: null, logo: null, watermark: null, qrCode: null, images: [] },
      budget: {
        id: '10000000-0000-4000-8000-000000000001', operationId: null, number: 27,
        status: 'DRAFT', title: 'Climatização do laboratório', description: 'Escopo técnico conforme vistoria.',
        issuedAt: now, introduction: 'Atendendo à honrosa solicitação de V.Sa., apresentamos nosso orçamento conforme solicitado.',
        serviceSubtotal: 850, materialSubtotal: 425, serviceDiscount: 50, materialDiscount: 25,
        serviceDiscountDescription: 'Condição especial para contratação integral',
        materialDiscountDescription: 'Desconto comercial nos fornecimentos',
        subtotal: 1275, discount: 75, additional: 0,
        total: 1200, amountInWords: 'um mil e duzentos reais', validityDays: 30,
        paymentMethods: ['PIX', 'CREDIT_CARD'], commercialNotes: 'Pagamento após aprovação.',
        expirationDate: new Date('2026-08-17T12:00:00.000Z'), observations: 'Validade sujeita à disponibilidade.',
        createdAt: now, creator: { name: 'Darlan Owner' }, operation: null, equipment: null,
        customerAddress: { name: 'Unidade Recife', street: 'Rua A', number: '100', district: 'Boa Viagem', city: 'Recife', state: 'PE' },
        customer: { name: 'Hospital Santa Clara', tradeName: 'Hospital Santa Clara', cnpj: '00.000.000/0001-00', cpf: null, phone: '+55 81 3000-0000', addresses: [], contacts: [{ name: 'Carlos', phone: '+55 81 99999-0000' }] },
        document: { id: '20000000-0000-4000-8000-000000000001', number: 'ORC-000027' },
        items: [
          { id: 'service', type: 'SERVICE', source: 'MANUAL', description: 'Higienização técnica', quantity: 1, unit: 'SERV', unitPrice: 850, total: 850, product: null },
          { id: 'description', type: 'MATERIAL', source: 'CATALOG', description: 'Tubulação frigorígena', quantity: 2, unit: 'UN', unitPrice: 0, total: 0, product: null },
          { id: 'material', type: 'MATERIAL', source: 'MANUAL', description: 'Filtro de reposição', quantity: 5, unit: 'UN', unitPrice: 85, total: 425, product: null },
        ],
      },
    };
    const built = (new DocumentBuilderService({} as never) as unknown as {
      buildFromContext: (ctx: unknown) => DocumentBlueprint;
    }).buildFromContext(context);
    expect(built.sections.map((section) => section.id)).toEqual([
      'budget-identification', 'budget-customer', 'budget-introduction', 'budget-services',
      'budget-service-description', 'budget-material-descriptions', 'budget-commercial-materials', 'budget-totals',
      'budget-commercial-conditions', 'signature',
    ]);
    const serviceDescription = built.sections.find((section) => section.id === 'budget-service-description');
    expect(serviceDescription?.title).toBe('Descrição do(s) serviço(s)');
    expect(serviceDescription?.components[0]).toMatchObject({
      id: 'budget-service-description-text',
      kind: 'observation',
      text: 'Escopo técnico conforme vistoria.',
    });
    expect(built.sections.findIndex((section) => section.id === 'budget-service-description')).toBeLessThan(
      built.sections.findIndex((section) => section.id === 'budget-commercial-materials'),
    );
    const services = built.sections.find((section) => section.id === 'budget-services')?.components[0];
    const descriptions = built.sections.find((section) => section.id === 'budget-material-descriptions')?.components[0];
    const materials = built.sections.find((section) => section.id === 'budget-commercial-materials')?.components[0];
    expect(services?.kind === 'table' ? services.rows : []).toHaveLength(2);
    expect(services?.kind === 'table' ? services.rows[1] : null).toEqual({
      item: 'Condição especial para contratação integral',
      quantity: '',
      unit: '',
      unitPrice: '',
      total: '- R$ 50,00',
    });
    expect(services?.kind === 'table' ? services.emphasizedRowIndexes : []).toEqual([1]);
    expect(descriptions?.kind === 'table' ? descriptions.columns.map((column) => column.key) : []).toEqual(['item', 'quantity']);
    expect(descriptions?.kind === 'table' ? descriptions.rows[0] : null).not.toHaveProperty('unitPrice');
    expect(materials?.kind === 'table' ? materials.rows : []).toHaveLength(2);
    expect(materials?.kind === 'table' ? materials.rows[1] : null).toEqual({
      item: 'Desconto comercial nos fornecimentos',
      quantity: '',
      unit: '',
      unitPrice: '',
      total: '- R$ 25,00',
    });
    expect(materials?.kind === 'table' ? materials.emphasizedRowIndexes : []).toEqual([1]);
    const totals = built.sections.find((section) => section.id === 'budget-totals')?.components[0];
    expect(totals?.kind === 'metadata' ? totals.items : []).toEqual(expect.arrayContaining([
      { label: 'Desconto nos serviços', value: 'R$ 50,00' },
      { label: 'Desconto nos materiais', value: 'R$ 25,00' },
      { label: 'Valor total', value: 'R$ 1.200,00' },
    ]));
    const identification = built.sections.find((section) => section.id === 'budget-identification')?.components[0];
    expect(
      identification?.kind === 'metadata'
        ? identification.items.find((item) => item.label === 'Status')?.value
        : null,
    ).toBe('Rascunho');
    const signature = built.sections.find((section) => section.id === 'signature')?.components[0];
    // Orçamento não coleta assinatura do cliente — apenas o responsável técnico.
    expect(signature?.kind === 'signature' ? signature.signatures.map((item) => item.role) : []).toEqual(['fixed']);
    const rendered = renderer().render(built);
    const pdf = await new PdfEngineService().create(rendered);
    expect(rendered.blueprint).toBe(built);
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

function operationContext(
  type: DocumentTemplateType,
): Record<string, unknown> & { configuration: Record<string, unknown> } {
  const now = new Date('2026-07-10T12:00:00.000Z');
  return {
    kind: 'operation',
    configuration: {
      type,
      organization: {
        legalName: 'ERP Operation LTDA',
        tradeName: 'Orbit',
        cnpj: '00.000.000/0001-00',
        stateRegistration: '0321418-40',
        email: 'contato@orbit.local',
        phone: '+55 81 99999-9999',
        phoneNumbers: ['+55 81 99999-9999', '+55 81 98888-7777'],
        website: 'https://orbit.local',
        zipCode: '50000-000',
        street: 'Rua Orbit',
        number: '100',
        complement: null,
        district: 'Centro',
        city: 'Recife',
        state: 'PE',
        primaryColor: '#111827',
        secondaryColor: '#2563EB',
      },
      settings: { timezone: 'America/Recife', currency: 'BRL' },
    },
    template: null,
    signature: {
      requiresSignature: false,
      signatureMode: 'NONE',
      signatureId: null,
      fixedSignature: null,
      institutionalSignatures: [],
      collectedSignature: null,
      executionSignatures: [],
    },
    assets: {
      signature: null,
      logo: null,
      watermark: null,
      qrCode: {
        storageKey: 'generated:qr',
        mimeType: 'image/png',
        fileSize: 68,
        contentBase64: ONE_PIXEL_PNG,
      },
      images: [],
    },
    operation: {
      id: '7db71471-0cf4-4414-8d06-83eb9c1917c9',
      number: 42,
      type: 'PREVENTIVA',
      status: 'COMPLETED',
      scheduledFor: now,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      signedAt: now,
      signatureData: null,
      customerSignerName: null,
      customerSignerRole: null,
      checklist: [{ label: 'Inspeção visual', done: true, note: 'Sem avarias aparentes' }],
      observations: 'Equipamento inspecionado e operando conforme registros do atendimento.',
      reportedIssue: null,
      serviceDescription: null,
      technicalDiagnosis: null,
      technicalRecommendations: null,
      technicalOpinionObjective: null,
      technicalOpinionObjectiveItems: [],
      technicalOpinionConditions: null,
      technicalOpinionAnalysis: null,
      technicalOpinionConclusion: null,
      technicalOpinionConclusionItems: [],
      technicalOpinionRecommendations: null,
      technicalOpinionResponsible: null,
      technicalOpinionCrea: null,
      referenceMonth: null,
      referenceYear: null,
      maintenanceType: null,
      maintenanceChecklistItems: [],
      inspectedEquipments: [],
      customer: {
        name: 'Hospital Santa Clara',
        tradeName: 'Hospital Santa Clara',
        cnpj: '00.000.000/0001-00',
        cpf: null,
        phone: '+55 81 3000-0000',
        addresses: [
          {
            name: 'Matriz',
            street: 'Rua A',
            number: '100',
            district: 'Boa Viagem',
            city: 'Recife',
            state: 'PE',
          },
        ],
        email: 'contato@hospital.local',
        contacts: [
          {
            name: 'Ana',
            role: 'Gestora de manutenção',
            phone: '+55 81 98888-0000',
            email: 'ana@hospital.local',
          },
        ],
      },
      address: null,
      equipment: {
        name: 'Chiller 01',
        tag: 'CH-01',
        type: 'CHILLER',
        manufacturer: 'York',
        model: 'YCAL',
        serialNumber: 'SN-123',
        qrCode: 'equipment:7db71471-0cf4-4414-8d06-83eb9c1917c9',
        metrics: [],
        attachments: [],
      },
      operator: { name: 'João Técnico', jobTitle: 'Técnico' },
      assignment: null,
      maintenanceExecution:
        type === DocumentTemplateType.PMOC
          ? {
              scheduledAt: now,
              executedAt: now,
              status: 'COMPLETED',
              plan: {
                name: 'PMOC Hospital',
                type: 'PREVENTIVE',
                priority: 'HIGH',
                description: 'Plano oficial',
                nextExecution: now,
                pmocPlan: {
                  id: '74bf6756-5356-4df2-a03d-e83810bd1430',
                  responsibleTechnician: 'Marina Engenheira',
                  contractNumber: 'PMOC-001',
                  artNumber: 'CREA-12345',
                  startDate: now,
                  endDate: new Date('2027-07-10T12:00:00.000Z'),
                  active: true,
                  environments: [],
                  equipments: [],
                },
              },
            }
          : null,
      parts: [],
      photos: [],
      documents: [],
    },
  };
}
