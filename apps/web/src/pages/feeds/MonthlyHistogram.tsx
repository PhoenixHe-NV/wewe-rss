import { FC } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Spinner,
} from '@nextui-org/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface MonthlyHistogramProps {
  isOpen: boolean;
  onClose: () => void;
  isLoading: boolean;
  data: { month: string; count: number }[] | undefined;
  mpId: string;
}

const MonthlyHistogram: FC<MonthlyHistogramProps> = ({ isOpen, onClose, isLoading, data, mpId }) => {
  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose}
      size="2xl"
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <div className="text-lg font-bold">文章按月份统计直方图</div>
              <div className="text-sm text-gray-500">统计该公众号内所有文章的月度发布量</div>
            </ModalHeader>
            <ModalBody>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner size="lg" />
                </div>
              ) : data && data.length > 0 ? (
                <div className="h-96 p-2 bg-white rounded-lg shadow-inner">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data}
                      margin={{
                        top: 5,
                        right: 30,
                        left: 20,
                        bottom: 25,
                      }}
                      style={{ fontFamily: 'sans-serif', fontSize: '12px' }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="month" 
                        angle={-45}
                        textAnchor="end"
                        height={50}
                        tick={{ fill: '#000000' }}  // 黑色字体
                      />
                      <YAxis tick={{ fill: '#000000' }} /> {/* 黑色字体 */}
                      <Tooltip
                        formatter={(value) => [`${value} 篇`, '文章数']}
                        labelFormatter={(label) => `${label} 月`}
                        contentStyle={{ color: '#000000' }}  // 提示框内容为黑色
                      />
                      <Legend 
                        wrapperStyle={{ color: '#000000' }}  // 图例文字为黑色
                      />
                      <Bar 
                        dataKey="count" 
                        name="文章数量" 
                        fill="#8884d8"
                        animationDuration={1000}
                        label={{
                          position: 'top',
                          fill: '#000000',
                          fontSize: 12
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex justify-center items-center py-8 text-lg">
                  {mpId ? '该公众号暂无文章数据' : '请先选择一个公众号'}
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button color="primary" onPress={onClose}>
                关闭
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};

export default MonthlyHistogram;
