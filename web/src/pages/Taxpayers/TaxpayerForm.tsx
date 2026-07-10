import { useEffect } from 'react';
import { Modal, Form, Input, Radio, InputNumber, message } from 'antd';
import axios from 'axios';
import {
  TaxpayerSubject,
  TaxpayerInput,
  createTaxpayer,
  updateTaxpayer,
} from '../../api/taxpayer';

// 纳税人类型选项
const TYPE_OPTIONS = [
  { label: '小规模纳税人', value: 'SMALL_SCALE' },
  { label: '一般纳税人', value: 'GENERAL' },
];

interface Props {
  open: boolean;
  // 传入则为编辑模式，否则为新建
  initialValues?: TaxpayerSubject | null;
  onCancel: () => void;
  onSuccess: () => void;
}

export default function TaxpayerForm({ open, initialValues, onCancel, onSuccess }: Props) {
  const [form] = Form.useForm<TaxpayerInput>();
  const isEdit = !!initialValues;

  // 打开时回填表单
  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: initialValues?.name,
        taxNumber: initialValues?.taxNumber,
        taxpayerType: initialValues?.taxpayerType,
        industry: initialValues?.industry ?? undefined,
        taxRate:
          initialValues?.taxRate !== undefined && initialValues?.taxRate !== null
            ? initialValues.taxRate
            : undefined,
        address: initialValues?.address ?? undefined,
        phone: initialValues?.phone ?? undefined,
        legalPerson: initialValues?.legalPerson ?? undefined,
      });
    } else {
      form.resetFields();
    }
  }, [open, initialValues, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // 税率按小数存储（如 0.03 表示 3%）
      if (isEdit && initialValues) {
        await updateTaxpayer(initialValues.id, values);
        message.success('更新成功');
      } else {
        await createTaxpayer(values);
        message.success('创建成功，科目体系已自动初始化');
      }
      onSuccess();
    } catch (e) {
      if (axios.isAxiosError(e)) {
        message.error(e.response?.data?.error || '操作失败');
      } else if (e instanceof Error && 'errorFields' in e) {
        // 表单校验错误，不提示
        return;
      }
    }
  };

  return (
    <Modal
      title={isEdit ? '编辑纳税人主体' : '新建纳税人主体'}
      open={open}
      onOk={handleSubmit}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      destroyOnClose
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ taxpayerType: 'GENERAL' }}
      >
        <Form.Item
          name="name"
          label="企业名称"
          rules={[{ required: true, message: '请输入企业名称' }]}
        >
          <Input placeholder="请输入企业名称" maxLength={100} />
        </Form.Item>

        <Form.Item
          name="taxNumber"
          label="纳税人识别号"
          rules={[
            { required: true, message: '请输入纳税人识别号' },
            {
              pattern: /^[A-Za-z0-9]{15,20}$/,
              message: '识别号应为 15-20 位字母或数字',
            },
          ]}
          extra="统一社会信用代码（18位）或纳税人识别号"
        >
          <Input placeholder="如 91110000XXXXXXXXXX" disabled={isEdit} />
        </Form.Item>

        <Form.Item
          name="taxpayerType"
          label="纳税人类型"
          rules={[{ required: true, message: '请选择纳税人类型' }]}
          extra={isEdit ? '已有科目的主体不允许修改类型' : undefined}
        >
          <Radio.Group options={TYPE_OPTIONS} disabled={isEdit} />
        </Form.Item>

        <Form.Item name="industry" label="行业">
          <Input placeholder="如 制造业 / 软件和信息技术服务业" maxLength={50} />
        </Form.Item>

        <Form.Item
          name="taxRate"
          label="适用税率"
          extra="小数表示，如 0.03 表示 3%，留空表示按业务混合"
        >
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            max={1}
            step={0.01}
            precision={4}
            placeholder="如 0.13"
          />
        </Form.Item>

        <Form.Item name="legalPerson" label="法人">
          <Input placeholder="请输入法人姓名" maxLength={50} />
        </Form.Item>

        <Form.Item name="phone" label="电话">
          <Input placeholder="请输入联系电话" maxLength={30} />
        </Form.Item>

        <Form.Item name="address" label="地址">
          <Input.TextArea rows={2} placeholder="请输入地址" maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
