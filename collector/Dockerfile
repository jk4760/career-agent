FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY requirements.txt .
# 清华镜像：本机与腾讯云服务器拉包都快
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
COPY src ./src
COPY config.yaml .
CMD ["python", "-m", "src"]
