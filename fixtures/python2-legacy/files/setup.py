from setuptools import setup, find_packages

setup(
    name="logparse",
    version="0.3.1",
    description="Parse and summarise Apache access logs",
    packages=find_packages(),
    python_requires=">=2.6",
    classifiers=[
        "Programming Language :: Python :: 2",
        "Programming Language :: Python :: 2.7",
    ],
)
