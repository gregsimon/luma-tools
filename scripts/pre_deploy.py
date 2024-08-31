# pre deploy script for luma-tools


from datetime import datetime


def main():
    # generate the build time/date
    f = open("public/luma1/deploy_date.txt", "w")
    date_time = datetime.now().astimezone().strftime("%m/%d/%Y, %H:%M:%S %Z")
    f.write(date_time)
    f.close()


main()
